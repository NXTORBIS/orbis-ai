/**
 * Distribution explorer: parameters, graph, statistics, interval probabilities
 * and comparison of two distributions.
 */
import { useMemo, useState } from 'react';
import {
  DISTRIBUTIONS,
  curve,
  defaultParams,
  getDistribution,
  intervalProbability,
  plotRange,
  summarize,
  validateParams,
  type IntervalKind,
} from '../../engine/distributions/registry';
import { EXACTNESS_LABEL } from '../../engine/core/result';
import type { Moment } from '../../engine/distributions/types';
import { Badge, Card, Checkbox, DataTable, Notice, NumberField, SelectField, SliderField } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { AssumptionsPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';
import { downloadText, toCsv } from '../../persistence/store';

export interface DistributionConfig {
  distributionId: string;
  params: Record<string, number>;
  /** Interval query. */
  intervalKind: IntervalKind;
  a: number;
  b: number;
  /** Optional comparison distribution. */
  compareEnabled: boolean;
  compareDistributionId: string;
  compareParams: Record<string, number>;
  showCdf: boolean;
}

export const DISTRIBUTION_DEFAULT: DistributionConfig = {
  distributionId: 'normal',
  params: { mu: 0, sigma: 1 },
  intervalKind: 'le',
  a: 1.96,
  b: 2,
  compareEnabled: false,
  compareDistributionId: 'studentT',
  compareParams: { nu: 5, mu: 0, sigma: 1 },
  showCdf: false,
};

const INTERVAL_OPTIONS: { value: IntervalKind; label: string }[] = [
  { value: 'le', label: 'X is at most a' },
  { value: 'lt', label: 'X is less than a' },
  { value: 'ge', label: 'X is at least a' },
  { value: 'gt', label: 'X is greater than a' },
  { value: 'between', label: 'X is between a and b' },
  { value: 'eq', label: 'X equals exactly a' },
];

export function DistributionExplorerTool({ config }: { config: DistributionConfig }) {
  const app = useApp();
  const set = (patch: Partial<DistributionConfig>) => app.updateConfig({ ...config, ...patch });
  const [showQuantiles, setShowQuantiles] = useState(false);

  const def = useMemo(() => {
    try {
      return getDistribution(config.distributionId);
    } catch {
      return getDistribution('normal');
    }
  }, [config.distributionId]);

  const issues = useMemo(() => validateParams(def, config.params), [def, config.params]);

  const computed = useMemo(() => {
    if (issues.length) return null;
    try {
      const range = plotRange(def, config.params);
      const pts = curve(def, config.params, range, def.kind === 'discrete' ? 0 : 420);
      const summary = summarize(def, config.params);
      const interval = intervalProbability(def, config.params, { kind: config.intervalKind, a: config.a, b: config.b });
      return { range, pts, summary, interval };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [def, config.params, config.intervalKind, config.a, config.b, issues]);

  const compare = useMemo(() => {
    if (!config.compareEnabled || !computed || 'error' in computed) return null;
    try {
      const cdef = getDistribution(config.compareDistributionId);
      if (validateParams(cdef, config.compareParams).length) return null;
      const cr = plotRange(cdef, config.compareParams);
      const range = { min: Math.min(computed.range.min, cr.min), max: Math.max(computed.range.max, cr.max) };
      const mixedKinds = cdef.kind !== def.kind;
      return {
        def: cdef,
        points: curve(cdef, config.compareParams, range, cdef.kind === 'discrete' ? 0 : 420),
        basePoints: curve(def, config.params, range, def.kind === 'discrete' ? 0 : 420),
        summary: summarize(cdef, config.compareParams),
        mixedKinds,
      };
    } catch {
      return null;
    }
  }, [config.compareEnabled, config.compareDistributionId, config.compareParams, computed, def, config.params]);

  const quantileRows = useMemo(() => {
    if (!computed || 'error' in computed) return [];
    const levels = [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999];
    return levels.map((p) => {
      try {
        return { p, value: def.quantile(p, config.params) };
      } catch {
        return { p, value: NaN };
      }
    });
  }, [def, config.params, computed]);

  const shadeRange = useMemo(() => {
    if (!computed || 'error' in computed) return null;
    const { min, max } = computed.range;
    switch (config.intervalKind) {
      case 'le':
      case 'lt':
        return { from: min, to: config.a, label: 'Selected region' };
      case 'ge':
      case 'gt':
        return { from: config.a, to: max, label: 'Selected region' };
      case 'between':
        return { from: config.a, to: config.b, label: 'Selected region' };
      default:
        return null;
    }
  }, [config.intervalKind, config.a, config.b, computed]);

  return (
    <>
      <ToolHeader toolId="distribution-explorer" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Distribution">
            <SelectField
              label="Distribution"
              value={config.distributionId}
              onChange={(distributionId) => {
                const next = getDistribution(distributionId);
                set({ distributionId, params: defaultParams(next) });
              }}
              options={DISTRIBUTIONS.map((d) => ({ value: d.id, label: `${d.name} (${d.kind})` }))}
              hint={def.description}
            />
            {def.params.map((spec) => (
              <SliderField
                key={spec.key}
                label={spec.label}
                symbol={spec.symbol}
                value={config.params[spec.key] ?? spec.defaultValue}
                onChange={(v) => set({ params: { ...config.params, [spec.key]: v } })}
                min={spec.sliderMin}
                max={spec.sliderMax}
                step={spec.step}
                integer={spec.integer}
                hint={spec.description}
                error={issues.find((i) => i.field === spec.key)?.message}
              />
            ))}
            {issues.filter((i) => !i.field || !def.params.some((p) => p.key === i.field)).length > 0 && (
              <Notice tone="error" items={issues.filter((i) => !i.field || !def.params.some((p) => p.key === i.field)).map((i) => i.message)} />
            )}
            <p className="oc-field__hint">
              Support: {def.supportText}. {def.notes.join(' ')}
            </p>
          </Card>

          <Card title="Probability of an interval">
            <SelectField label="Question" value={config.intervalKind} onChange={(intervalKind) => set({ intervalKind })} options={INTERVAL_OPTIONS} />
            <NumberField label="Value a" value={config.a} onChange={(a) => set({ a })} integer={def.kind === 'discrete'} />
            {config.intervalKind === 'between' && <NumberField label="Value b" value={config.b} onChange={(b) => set({ b })} min={config.a} integer={def.kind === 'discrete'} />}
          </Card>

          <Card title="Compare with another distribution">
            <Checkbox checked={config.compareEnabled} onChange={(compareEnabled) => set({ compareEnabled })} label="Show a second distribution" />
            {config.compareEnabled && (
              <>
                <SelectField
                  label="Second distribution"
                  value={config.compareDistributionId}
                  onChange={(compareDistributionId) => {
                    const next = getDistribution(compareDistributionId);
                    set({ compareDistributionId, compareParams: defaultParams(next) });
                  }}
                  options={DISTRIBUTIONS.map((d) => ({ value: d.id, label: d.name }))}
                />
                {getDistribution(config.compareDistributionId).params.map((spec) => (
                  <SliderField
                    key={spec.key}
                    label={spec.label}
                    symbol={spec.symbol}
                    value={config.compareParams[spec.key] ?? spec.defaultValue}
                    onChange={(v) => set({ compareParams: { ...config.compareParams, [spec.key]: v } })}
                    min={spec.sliderMin}
                    max={spec.sliderMax}
                    step={spec.step}
                    integer={spec.integer}
                  />
                ))}
              </>
            )}
          </Card>

          <AiAssistPanel capability="suggestMethod" context="Each distribution's description above says what it models, and its notes record the parameterisation used." />
        </div>

        <div className="oc-stack">
          {computed && 'error' in computed && <Notice tone="error" title="This chart could not be produced">{computed.error}</Notice>}
          {issues.length > 0 && <Notice tone="error" title="Adjust the parameters" items={issues.map((i) => i.message)} />}

          {computed && !('error' in computed) && (
            <>
              <Card title={computed.interval.notation}>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">{computed.interval.notation}</span>
                  <span className="oc-result-hero__value">{formatPercent(computed.interval.probability, 5)}</span>
                  <span className="oc-result-hero__detail">
                    {formatValue(computed.interval.probability, 8)} · complement {formatPercent(computed.interval.complement, 5)} ·{' '}
                    <span className="oc-muted">{computed.interval.method}</span>
                  </span>
                </div>
                {computed.interval.note && <Notice tone="info" title="About this value">{computed.interval.note}</Notice>}
                {def.kind === 'continuous' && (
                  <p className="oc-chart-note">
                    For a continuous distribution the curve shows <strong>density</strong>, not probability. The height at a point is not the probability of
                    that point — that is always 0. Probability is the area under the curve, which is what the shaded region shows.
                  </p>
                )}
              </Card>

              <Card>
                {def.kind === 'discrete' ? (
                  <BarChart
                    title={`${def.name}: probability of each value`}
                    description={`Probability mass function of the ${def.name} distribution with ${def.params.map((p) => `${p.symbol} = ${config.params[p.key]}`).join(', ')}.`}
                    data={computed.pts.map((pt) => ({ x: pt.x, y: pt.pdf }))}
                    xLabel="Value"
                    yLabel="Probability"
                    seriesLabel="Probability"
                    highlight={shadeRange ? { from: shadeRange.from, to: shadeRange.to } : config.intervalKind === 'eq' ? { from: config.a, to: config.a } : null}
                    note={
                      computed.range.massOutside > 1e-6
                        ? `The visible range covers values ${computed.range.min} to ${computed.range.max}; ${formatPercent(computed.range.massOutside, 3)} of the probability lies outside it.`
                        : 'The visible range contains essentially all of the probability.'
                    }
                    onExport={() => downloadText(`${def.id}-pmf.csv`, toCsv(['value', 'probability', 'cumulative'], computed.pts.map((p) => [p.x, p.pdf, p.cdf])))}
                  />
                ) : (
                  <LineChart
                    title={`${def.name}: ${config.showCdf ? 'cumulative distribution' : 'probability density'}`}
                    description={`${config.showCdf ? 'Cumulative distribution function' : 'Probability density function'} of the ${def.name} distribution with ${def.params.map((p) => `${p.symbol} = ${config.params[p.key]}`).join(', ')}.`}
                    series={[
                      {
                        label: config.showCdf ? 'Cumulative probability' : 'Density',
                        points: computed.pts.map((pt) => ({ x: pt.x, y: config.showCdf ? pt.cdf : pt.pdf })),
                        area: !config.showCdf,
                      },
                    ]}
                    xLabel="Value"
                    yLabel={config.showCdf ? 'P(X ≤ value)' : 'Probability density'}
                    yDomain={config.showCdf ? [0, 1] : undefined}
                    shadeRange={config.showCdf ? null : shadeRange}
                    valueFormatter={(v) => (config.showCdf ? formatPercent(v) : formatValue(v, 5))}
                    markers={
                      computed.summary.mean.defined && Number.isFinite(computed.summary.mean.value) && !config.showCdf
                        ? [{ x: computed.summary.mean.value, y: def.pdf(computed.summary.mean.value, config.params), label: 'Mean' }]
                        : undefined
                    }
                    note={
                      computed.range.massOutside > 1e-6
                        ? `Visible range ${formatValue(computed.range.min, 4)} to ${formatValue(computed.range.max, 4)}; ${formatPercent(computed.range.massOutside, 3)} of the probability lies outside it. The distribution continues beyond the edges of the chart.`
                        : undefined
                    }
                    onExport={() => downloadText(`${def.id}-curve.csv`, toCsv(['x', 'density', 'cumulative'], computed.pts.map((p) => [p.x, p.pdf, p.cdf])))}
                  />
                )}
                {def.kind === 'continuous' && (
                  <div style={{ marginTop: 'var(--s3)' }}>
                    <Checkbox checked={config.showCdf} onChange={(showCdf) => set({ showCdf })} label="Show the cumulative distribution instead of the density" />
                  </div>
                )}
              </Card>

              {compare && (
                <Card>
                  <LineChart
                    title={`${def.name} compared with ${compare.def.name}`}
                    description={`Two distributions plotted on the same axes for comparison.`}
                    series={[
                      { label: def.name, points: compare.basePoints.map((p) => ({ x: p.x, y: p.pdf })), area: def.kind === 'continuous' },
                      { label: compare.def.name, points: compare.points.map((p) => ({ x: p.x, y: p.pdf })), dashed: true },
                    ]}
                    xLabel="Value"
                    yLabel={def.kind === compare.def.kind ? (def.kind === 'discrete' ? 'Probability' : 'Probability density') : 'Probability / density'}
                    valueFormatter={(v) => formatValue(v, 5)}
                    note={
                      compare.mixedKinds
                        ? 'One of these distributions is discrete and the other continuous, so the vertical axis means different things for the two curves: probability for the discrete one, density for the continuous one. They are not directly comparable in height.'
                        : 'Both curves use the same vertical scale, so their heights are directly comparable.'
                    }
                  />
                  <DataTable
                    caption="Comparison of summary statistics"
                    columns={[
                      { key: 's', header: 'Statistic', render: (r) => (r as Cmp).stat },
                      { key: 'a', header: def.name, numeric: true, render: (r) => (r as Cmp).a },
                      { key: 'b', header: compare.def.name, numeric: true, render: (r) => (r as Cmp).b },
                    ]}
                    rows={
                      [
                        { stat: 'Mean', a: moment(computed.summary.mean), b: moment(compare.summary.mean) },
                        { stat: 'Median', a: formatValue(computed.summary.median, 5), b: formatValue(compare.summary.median, 5) },
                        { stat: 'Standard deviation', a: moment(computed.summary.sd), b: moment(compare.summary.sd) },
                        { stat: 'Skewness', a: moment(computed.summary.skewness), b: moment(compare.summary.skewness) },
                        { stat: 'Excess kurtosis', a: moment(computed.summary.excessKurtosis), b: moment(compare.summary.excessKurtosis) },
                      ] as Cmp[]
                    }
                  />
                </Card>
              )}

              <Card title="Summary statistics" actions={<Badge variant={def.closedFormQuantile ? 'exact' : 'numerical'}>{EXACTNESS_LABEL[def.closedFormQuantile ? 'exact' : 'numerical']}</Badge>}>
                <div className="oc-figure-grid">
                  <Fig label="Mean" value={moment(computed.summary.mean)} />
                  <Fig label="Median" value={formatValue(computed.summary.median, 6)} />
                  <Fig label="Mode" value={moment(computed.summary.mode)} />
                  <Fig label="Variance" value={moment(computed.summary.variance)} />
                  <Fig label="Standard deviation" value={moment(computed.summary.sd)} />
                  <Fig label="Skewness" value={moment(computed.summary.skewness)} sub={skewNote(computed.summary.skewness)} />
                  <Fig label="Excess kurtosis" value={moment(computed.summary.excessKurtosis)} sub={kurtNote(computed.summary.excessKurtosis)} />
                </div>
                {[computed.summary.mean, computed.summary.variance, computed.summary.skewness, computed.summary.excessKurtosis]
                  .filter((m) => !m.defined)
                  .map((m, i) => (
                    <Notice key={i} tone="info" title="Undefined statistic">
                      <p>{(m as { reason: string }).reason}</p>
                    </Notice>
                  ))}
              </Card>

              <Card
                title="Quantiles"
                hint="The value below which a given share of the probability lies."
                actions={<Checkbox checked={showQuantiles} onChange={setShowQuantiles} label="Show table" />}
              >
                {showQuantiles ? (
                  <DataTable
                    caption="Quantiles of the distribution"
                    columns={[
                      { key: 'p', header: 'Share below', numeric: true, render: (r) => formatPercent((r as Q).p, 4) },
                      { key: 'v', header: 'Value', numeric: true, render: (r) => formatValue((r as Q).value, 6) },
                    ]}
                    rows={quantileRows as Q[]}
                  />
                ) : (
                  <div className="oc-figure-grid">
                    {[0.05, 0.25, 0.5, 0.75, 0.95].map((p) => (
                      <Fig key={p} label={`${(p * 100).toFixed(0)}th percentile`} value={formatValue(quantileRows.find((q) => q.p === p)?.value ?? NaN, 5)} />
                    ))}
                  </div>
                )}
                {!def.closedFormQuantile && (
                  <p className="oc-chart-note">
                    This distribution has no closed-form inverse, so quantiles are found by numerical root finding on the cumulative distribution, accurate to
                    about 14 significant digits.
                  </p>
                )}
              </Card>

              <AssumptionsPanel
                assumptions={[`${def.description}`, ...def.notes, `Typical uses: ${def.useCases.join('; ')}.`]}
                limitations={[
                  'A distribution is a model. Choosing it is an assumption about the process, and the numbers above inherit that assumption.',
                  def.kind === 'continuous'
                    ? 'Density values are not probabilities. Only areas under the curve are probabilities.'
                    : 'This distribution assigns probability only to whole numbers in its support; other values have probability 0.',
                ]}
                title="What this distribution assumes"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface Cmp {
  stat: string;
  a: string;
  b: string;
}
interface Q {
  p: number;
  value: number;
}

function moment(m: Moment): string {
  return m.defined ? formatValue(m.value, 6) : 'undefined';
}

function skewNote(m: Moment): string | undefined {
  if (!m.defined) return undefined;
  if (Math.abs(m.value) < 0.1) return 'Symmetric';
  return m.value > 0 ? 'Long right tail' : 'Long left tail';
}

function kurtNote(m: Moment): string | undefined {
  if (!m.defined) return undefined;
  if (Math.abs(m.value) < 0.1) return 'Normal-like tails';
  return m.value > 0 ? 'Heavier tails than normal' : 'Lighter tails than normal';
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="oc-figure">
      <span className="oc-figure__label">{label}</span>
      <div className="oc-figure__value" style={{ fontSize: 16 }}>
        {value}
      </div>
      {sub && <div className="oc-figure__sub">{sub}</div>}
    </div>
  );
}
