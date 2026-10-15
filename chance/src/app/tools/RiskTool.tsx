/**
 * Risk explorer: an aggregate loss model with Value at Risk and Expected
 * Shortfall, plus a risk register of individual risks and mitigations.
 */
import { useMemo, useState } from 'react';
import { analyseRiskRegister, parametricNormalRisk, riskMetrics, type RiskRegisterEntry } from '../../engine/risk/risk';
import { DISTRIBUTIONS, defaultParams, getDistribution, validateParams } from '../../engine/distributions/registry';
import { Badge, Button, Card, Checkbox, DataTable, Notice, NumberField, Segmented, SelectField, SliderField, TextField } from '../../ui/primitives';
import { formatPercent, formatValue, seriesColor } from '../../ui/charts/scale';
import { HistogramChart, LineChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { AssumptionsPanel } from '../shared/ExplanationPanel';
import { RunPanel, SimulationSettingsCard, useSimulationRun } from '../shared/SimulationControls';
import { OutputSummary } from '../shared/SimulationResults';
import { useApp } from '../store';
import { downloadText, toCsv } from '../../persistence/store';
import type { ReportSection, ToolReportContent } from '../../persistence/report';
import { newId } from '../../persistence/store';

export interface RiskToolConfig {
  mode: 'aggregate' | 'register';
  aggregate: {
    frequency: { distributionId: string; params: Record<string, number> };
    severity: { distributionId: string; params: Record<string, number> };
    threshold: number;
    unit: string;
    perEventCap?: number;
    useCap: boolean;
  };
  levels: number[];
  thresholds: number[];
  register: { entries: RiskRegisterEntry[]; assumeIndependent: boolean };
  trials: number;
  seed: string;
}

export const RISK_DEFAULT: RiskToolConfig = {
  mode: 'aggregate',
  aggregate: {
    frequency: { distributionId: 'poisson', params: { lambda: 3 } },
    severity: { distributionId: 'lognormal', params: { mu: 8, sigma: 1.2 } },
    threshold: 50000,
    unit: 'GBP',
    useCap: false,
  },
  levels: [0.95, 0.99],
  thresholds: [25000, 50000, 100000],
  register: {
    entries: [
      { id: 'r1', label: 'Key supplier fails', probability: 0.08, probabilitySource: 'estimate', impact: 120000, impactSource: 'estimate', mitigation: { label: 'Qualify a second supplier', probability: 0.08, impact: 40000, cost: 15000 } },
      { id: 'r2', label: 'Critical staff departure', probability: 0.25, probabilitySource: 'estimate', impact: 45000, impactSource: 'estimate' },
      { id: 'r3', label: 'Regulatory change', probability: 0.15, probabilitySource: 'estimate', impact: 80000, impactSource: 'estimate' },
    ],
    assumeIndependent: true,
  },
  trials: 100000,
  seed: 'risk-1',
};

export function RiskTool({ config }: { config: RiskToolConfig }) {
  const app = useApp();
  const set = (patch: Partial<RiskToolConfig>) => app.updateConfig({ ...config, ...patch });
  const run = useSimulationRun();
  const [thresholdDraft, setThresholdDraft] = useState('');

  const modelConfig = useMemo(
    () => ({
      frequency: config.aggregate.frequency,
      severity: config.aggregate.severity,
      threshold: config.aggregate.threshold,
      unit: config.aggregate.unit,
      perEventCap: config.aggregate.useCap ? config.aggregate.perEventCap : undefined,
    }),
    [config.aggregate],
  );

  const configIssues = useMemo(() => {
    const out: string[] = [];
    const freq = getDistribution(config.aggregate.frequency.distributionId);
    const sev = getDistribution(config.aggregate.severity.distributionId);
    out.push(...validateParams(freq, config.aggregate.frequency.params).map((i) => `Event count: ${i.message}`));
    out.push(...validateParams(sev, config.aggregate.severity.params).map((i) => `Loss per event: ${i.message}`));
    if (freq.kind !== 'discrete') out.push('The number of events must come from a discrete distribution, such as Poisson or binomial.');
    return out;
  }, [config.aggregate]);

  const metrics = useMemo(() => {
    const result = run.state.result;
    if (!result?.samples) return null;
    const losses = result.samples.total;
    if (!losses) return null;
    try {
      return riskMetrics({ losses, levels: config.levels, thresholds: config.thresholds, unit: config.aggregate.unit });
    } catch {
      return null;
    }
  }, [run.state.result, config.levels, config.thresholds, config.aggregate.unit]);

  const registerResult = useMemo(() => {
    if (config.mode !== 'register') return null;
    try {
      return { ok: true as const, value: analyseRiskRegister(config.register.entries, config.register.assumeIndependent) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config.mode, config.register]);

  const lossCurve = useMemo(() => {
    if (!metrics || !run.state.result?.outputs) return null;
    const out = run.state.result.outputs.find((o) => o.spec.key === 'total');
    if (!out) return null;
    // Exceedance curve: for each loss level, the probability of exceeding it.
    return out.ecdf.map((p) => ({ x: p.x, y: 1 - p.p }));
  }, [metrics, run.state.result]);

  /**
   * What this screen contributes to an exported report. Built on demand, from
   * the same values that are rendered: nothing is recomputed here, and where a
   * figure does not exist the section says so rather than offering one.
   */
  const buildReport = (): ToolReportContent => {
    const unit = config.aggregate.unit;
    const sections: ReportSection[] = [];

    if (config.mode === 'aggregate') {
      if (configIssues.length > 0) {
        sections.push({
          title: 'Aggregate loss model',
          refusal: `The model was not in a state that could be simulated: ${configIssues.join(' ')}`,
        });
      } else if (!run.state.result) {
        sections.push({
          title: 'Aggregate loss model',
          missing:
            'The loss simulation had not been run when this report was exported, so there is no loss distribution, no Value at Risk and no Expected Shortfall to report. These figures cannot be derived from the configuration: they need the simulated distribution. Run "Simulate the loss distribution" on the Risk screen and export the report again.',
        });
      } else if (!metrics) {
        sections.push({
          title: 'Aggregate loss model',
          refusal:
            'The simulation completed but produced no usable total-loss values, so the risk metrics could not be computed. No risk figures are reported for this run.',
        });
      } else {
        const total = run.state.result.outputs.find((o) => o.spec.key === 'total');
        sections.push({
          title: 'Headline risk figures',
          description: `Estimated from ${metrics.n.toLocaleString('en-US')} simulated periods with seed "${config.seed}". Re-running with the same seed reproduces these figures exactly; a different seed gives slightly different ones.`,
          exactness: 'empirical',
          rows: [
            { label: `Expected total loss per period (${unit})`, value: metrics.expectedLoss },
            { label: 'Standard error of that estimate', value: metrics.expectedLossStandardError, note: 'sampling error of the simulated mean' },
            { label: `Worst simulated period (${unit})`, value: metrics.worstSimulated, note: 'the largest total seen in these trials, not a maximum possible loss' },
            { label: `Best simulated period (${unit})`, value: metrics.bestSimulated },
            { label: 'Proportion of periods with any loss at all', value: metrics.probabilityOfAnyLoss },
            { label: 'Simulated periods', value: metrics.n },
          ],
          intervals: total
            ? [
                {
                  label: 'the expected total loss',
                  kind: 'confidence-interval',
                  lower: total.estimateInterval.low,
                  upper: total.estimateInterval.high,
                  level: total.estimateInterval.level,
                  note: `Method: ${total.estimateInterval.method}. This says how precisely the long-run average is known from this many trials.`,
                },
                {
                  label: 'the total loss in a single period',
                  kind: 'simulated-percentile-range',
                  lower: total.summary.quantiles.find((q) => q.p === 0.05)?.value ?? total.summary.min,
                  upper: total.summary.quantiles.find((q) => q.p === 0.95)?.value ?? total.summary.max,
                  percentiles: [5, 95],
                  note: 'How much the outcome itself varies from period to period. Running more trials does not narrow this; it is a property of the model, not of the estimate.',
                },
              ]
            : undefined,
          warnings: [...run.state.result.warnings, ...metrics.var.flatMap((v) => v.warnings)],
          assumptions: run.state.result.assumptions,
          limitations: metrics.limitations,
        });

        sections.push({
          title: 'Value at Risk and Expected Shortfall',
          description: `${metrics.lossConvention} Value at Risk at a level is the loss exceeded in (1 − level) of periods; Expected Shortfall is the average loss in exactly those worst periods.`,
          exactness: 'empirical',
          tables: [
            {
              caption: 'Value at Risk and Expected Shortfall by level',
              columns: ['Level', `Value at Risk (${unit})`, `Expected Shortfall (${unit})`, 'Trials in the tail', 'Standard error of VaR', 'Standard error of ES'],
              rows: metrics.var.map((v) => [
                formatPercent(v.level, 4),
                v.valueAtRisk,
                v.expectedShortfall,
                v.tailCount,
                v.varStandardError === null ? 'not available for this level' : v.varStandardError,
                v.esStandardError === null ? 'not available for this level' : v.esStandardError,
              ]),
              note: 'Both figures are percentiles and tail averages of the simulated outcomes. Neither is a confidence interval.',
            },
          ],
        });

        if (metrics.exceedance.length > 0) {
          sections.push({
            title: 'Probability of exceeding a threshold',
            exactness: 'empirical',
            tables: [
              {
                caption: 'Threshold exceedance',
                columns: [`Threshold (${unit})`, 'Probability of exceeding', '95% confidence interval for that probability', 'Trials exceeding', `Average loss when exceeded (${unit})`],
                rows: metrics.exceedance.map((e) => [
                  e.threshold,
                  formatPercent(e.probability, 4),
                  `${formatPercent(e.low, 3)} to ${formatPercent(e.high, 3)}`,
                  e.count,
                  Number.isNaN(e.conditionalMean) ? 'never exceeded in these trials' : e.conditionalMean,
                ]),
                note: `The interval in the third column is a confidence interval for the exceedance probability — how precisely the probability is estimated from ${metrics.n.toLocaleString('en-US')} trials. A threshold never exceeded here is not impossible: its probability is simply below about ${formatPercent(3 / metrics.n, 2)}, the smallest this many trials can resolve.`,
              },
            ],
          });
        }

        if (lossCurve) {
          sections.push({
            title: 'Loss exceedance curve',
            exactness: 'empirical',
            charts: [
              {
                title: 'Loss exceedance curve',
                description: 'For each loss level, the simulated probability that the total loss exceeds it.',
                table: {
                  caption: 'Exceedance probability by loss level',
                  columns: [`Loss (${unit})`, 'Probability of exceeding'],
                  rows: lossCurve.map((p) => [p.x, p.y]),
                  note: 'The far right of this curve rests on few simulated outcomes and is correspondingly unreliable.',
                },
              },
            ],
          });
        }

        if (total) {
          sections.push({
            title: 'Distribution of total loss',
            exactness: 'empirical',
            charts: [
              {
                title: 'Histogram of simulated total losses',
                description: 'How often the simulated total loss fell in each band.',
                table: {
                  caption: 'Histogram of simulated total losses',
                  columns: [`Band from (${unit})`, `Band to (${unit})`, 'Trials in band', 'Proportion of trials'],
                  rows: total.histogram.map((b) => [b.x0, b.x1, b.count, b.proportion]),
                },
              },
            ],
            rows: [
              { label: `Mean (${unit})`, value: total.summary.mean },
              { label: 'Standard deviation', value: total.summary.sd },
              { label: `Median (${unit})`, value: total.summary.median },
              { label: 'Skewness', value: total.summary.skewness },
              { label: 'Excess kurtosis', value: total.summary.excessKurtosis },
            ],
            tables: [
              {
                caption: 'Percentiles of the simulated total loss',
                columns: ['Percentile', `Total loss (${unit})`],
                rows: total.summary.quantiles.map((q) => [formatPercent(q.p, 4), q.value]),
                note: 'These are percentiles of the simulated outcomes, describing how spread out the outcomes are. They are not an interval for any estimate.',
              },
            ],
            warnings: total.warnings,
          });
        }
      }
    } else {
      if (!registerResult) {
        sections.push({ title: 'Risk register', missing: 'The risk register was not evaluated on this screen.' });
      } else if (!registerResult.ok) {
        sections.push({ title: 'Risk register', refusal: registerResult.error });
      } else {
        const reg = registerResult.value;
        sections.push({
          title: 'Risk register: expected loss',
          description:
            'Expected loss is probability × impact. Every probability and impact here was entered by hand, so these figures are the consequences of stated judgements rather than measurements.',
          exactness: 'assumed',
          rows: [
            { label: 'Total expected loss across all risks', value: reg.totalExpectedLoss },
            {
              label: 'Probability at least one risk occurs',
              value: formatPercent(reg.probabilityAtLeastOne, 4),
              note: reg.independenceAssumed
                ? 'computed assuming the risks are independent, which was selected on the screen'
                : 'an upper bound, making no assumption about how the risks relate',
            },
          ],
          tables: [
            {
              caption: 'Risk register',
              columns: ['Risk', 'Probability', 'Where the probability comes from', 'Impact', 'Expected loss', 'Share of total', 'Expected loss with mitigation', 'Net benefit of mitigating'],
              rows: reg.entries.map((e) => [
                e.entry.label,
                formatPercent(e.entry.probability, 3),
                e.entry.probabilitySource === 'estimate' ? 'a judgement (not measured)' : e.entry.probabilitySource === 'data' ? 'measured from data' : 'calculated from a model',
                e.entry.impact,
                e.expectedLoss,
                formatPercent(e.share, 3),
                e.mitigatedExpectedLoss === null ? 'no mitigation entered' : e.mitigatedExpectedLoss,
                e.netBenefit === null ? 'no mitigation entered' : e.netBenefit,
              ]),
            },
          ],
          limitations: reg.limitations,
        });
      }
    }

    return {
      sections,
      configNote:
        config.mode === 'aggregate'
          ? 'Approach: loss distribution (frequency and severity simulated, then totalled per period).'
          : 'Approach: risk register (expected values from entered probabilities and impacts; no distribution is simulated).',
    };
  };

  return (
    <>
      <ToolHeader toolId="risk" report={buildReport} />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Approach">
            <Segmented
              label="Risk approach"
              value={config.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: 'aggregate', label: 'Loss distribution' },
                { value: 'register', label: 'Risk register' },
              ]}
            />
            <p className="oc-field__hint">
              {config.mode === 'aggregate'
                ? 'Model how often losses occur and how large each one is, then simulate the total. This gives a full loss distribution, Value at Risk and Expected Shortfall.'
                : 'List individual risks with a probability and an impact. Quicker to set up, but it only gives expected values, not a distribution.'}
            </p>
          </Card>

          {config.mode === 'aggregate' ? (
            <>
              <Card title="How often losses occur">
                <SelectField
                  label="Distribution for the number of events"
                  value={config.aggregate.frequency.distributionId}
                  onChange={(distributionId) => set({ aggregate: { ...config.aggregate, frequency: { distributionId, params: defaultParams(getDistribution(distributionId)) } } })}
                  options={DISTRIBUTIONS.filter((d) => d.kind === 'discrete').map((d) => ({ value: d.id, label: d.name }))}
                  hint={getDistribution(config.aggregate.frequency.distributionId).description}
                />
                {getDistribution(config.aggregate.frequency.distributionId).params.map((spec) => (
                  <SliderField
                    key={spec.key}
                    label={spec.label}
                    symbol={spec.symbol}
                    value={config.aggregate.frequency.params[spec.key] ?? spec.defaultValue}
                    onChange={(v) => set({ aggregate: { ...config.aggregate, frequency: { ...config.aggregate.frequency, params: { ...config.aggregate.frequency.params, [spec.key]: v } } } })}
                    min={spec.sliderMin}
                    max={spec.sliderMax}
                    step={spec.step}
                    integer={spec.integer}
                  />
                ))}
              </Card>

              <Card title="How large each loss is">
                <SelectField
                  label="Distribution for the loss per event"
                  value={config.aggregate.severity.distributionId}
                  onChange={(distributionId) => set({ aggregate: { ...config.aggregate, severity: { distributionId, params: defaultParams(getDistribution(distributionId)) } } })}
                  options={DISTRIBUTIONS.filter((d) => d.kind === 'continuous' && d.support(defaultParams(d)).min >= 0).map((d) => ({ value: d.id, label: d.name }))}
                  hint={getDistribution(config.aggregate.severity.distributionId).description}
                />
                {getDistribution(config.aggregate.severity.distributionId).params.map((spec) => (
                  <SliderField
                    key={spec.key}
                    label={spec.label}
                    symbol={spec.symbol}
                    value={config.aggregate.severity.params[spec.key] ?? spec.defaultValue}
                    onChange={(v) => set({ aggregate: { ...config.aggregate, severity: { ...config.aggregate.severity, params: { ...config.aggregate.severity.params, [spec.key]: v } } } })}
                    min={spec.sliderMin}
                    max={spec.sliderMax}
                    step={spec.step}
                    integer={spec.integer}
                  />
                ))}
                <p className="oc-field__hint">
                  Mean loss per event:{' '}
                  {(() => {
                    const m = getDistribution(config.aggregate.severity.distributionId).mean(config.aggregate.severity.params);
                    return m.defined ? `${formatValue(m.value)} ${config.aggregate.unit}` : 'undefined for these parameters';
                  })()}
                </p>
                <Checkbox
                  checked={config.aggregate.useCap}
                  onChange={(useCap) => set({ aggregate: { ...config.aggregate, useCap, perEventCap: config.aggregate.perEventCap ?? 100000 } })}
                  label="Cap each individual loss"
                  description="For example an insurance limit per event."
                />
                {config.aggregate.useCap && (
                  <NumberField label="Cap per event" value={config.aggregate.perEventCap ?? 100000} onChange={(perEventCap) => set({ aggregate: { ...config.aggregate, perEventCap } })} min={0.01} unit={config.aggregate.unit} />
                )}
              </Card>

              <Card title="Reporting">
                <TextField label="Unit" value={config.aggregate.unit} onChange={(unit) => set({ aggregate: { ...config.aggregate, unit } })} maxLength={12} />
                <NumberField label="Main threshold of interest" value={config.aggregate.threshold} onChange={(threshold) => set({ aggregate: { ...config.aggregate, threshold } })} unit={config.aggregate.unit} />
                <div className="oc-field">
                  <span className="oc-field__label">Confidence levels for Value at Risk</span>
                  <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                    {[0.9, 0.95, 0.99, 0.995, 0.999].map((l) => {
                      const on = config.levels.includes(l);
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={on}
                          className="oc-btn oc-btn--sm"
                          style={on ? { background: 'var(--accent-dim)', borderColor: 'var(--accent)' } : undefined}
                          onClick={() => set({ levels: on ? config.levels.filter((x) => x !== l) : [...config.levels, l].sort((a, b) => a - b) })}
                        >
                          {on ? '✓ ' : ''}
                          {(l * 100).toFixed(l >= 0.995 ? 1 : 0)}%
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="oc-field">
                  <span className="oc-field__label">Exceedance thresholds</span>
                  <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap', marginBottom: 'var(--s2)' }}>
                    {config.thresholds.map((t) => (
                      <span key={t} className="oc-badge">
                        {formatValue(t)}
                        <button type="button" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 4 }} aria-label={`Remove threshold ${t}`} onClick={() => set({ thresholds: config.thresholds.filter((x) => x !== t) })}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <input className="oc-input oc-input--numeric" value={thresholdDraft} placeholder="Add a threshold" aria-label="New threshold value" onChange={(e) => setThresholdDraft(e.target.value)} />
                    <Button
                      icon="plus"
                      title="Add threshold"
                      disabled={!Number.isFinite(Number(thresholdDraft)) || !thresholdDraft.trim() || config.thresholds.length >= 8}
                      onClick={() => {
                        const v = Number(thresholdDraft);
                        if (Number.isFinite(v) && !config.thresholds.includes(v)) set({ thresholds: [...config.thresholds, v].sort((a, b) => a - b) });
                        setThresholdDraft('');
                      }}
                    />
                  </div>
                </div>
              </Card>

              <SimulationSettingsCard settings={{ trials: config.trials, seed: config.seed, keepSamples: true }} onChange={(s) => set({ trials: s.trials, seed: s.seed })} note="Tail figures such as 99.9% Value at Risk need a large number of trials to be reliable." />

              <RunPanel
                state={run.state}
                onRun={() => run.run({ modelId: 'risk-aggregate', config: modelConfig, trials: config.trials, seed: config.seed, keepSamples: true })}
                onCancel={run.cancel}
                runLabel="Simulate the loss distribution"
                disabled={configIssues.length > 0}
                fallbackReason={run.fallbackReason}
              />
            </>
          ) : (
            <RegisterEditor config={config} set={set} />
          )}

          <AiAssistPanel capability="explainUncertainty" context="Each figure below states what it measures and what it leaves out; the limitations panel lists the assumptions in full." />
        </div>

        <div className="oc-stack">
          {config.mode === 'aggregate' && (
            <>
              {configIssues.length > 0 && <Notice tone="error" title="The model is not configured correctly" items={configIssues} />}

              {!run.state.result && configIssues.length === 0 && (
                <Card>
                  <Notice tone="info" title="Nothing simulated yet">
                    <p>
                      Run the simulation to obtain the loss distribution. The expected total loss follows from the model directly: E[total] = E[number of
                      events] × E[loss per event], but Value at Risk and Expected Shortfall need the simulated distribution.
                    </p>
                  </Notice>
                </Card>
              )}

              {run.state.result && metrics && (
                <>
                  <Card title="Headline risk figures">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Expected total loss per period</span>
                      <span className="oc-result-hero__value">
                        {formatValue(metrics.expectedLoss)} {config.aggregate.unit}
                      </span>
                      <span className="oc-result-hero__detail">
                        Standard error of this estimate ±{formatValue(metrics.expectedLossStandardError, 4)} · worst simulated outcome{' '}
                        {formatValue(metrics.worstSimulated)} {config.aggregate.unit}
                      </span>
                      <span className="oc-result-hero__detail oc-muted">
                        The expected loss is a long-run average. In {formatPercent(metrics.probabilityOfAnyLoss, 4)} of periods there was a loss at all, and the
                        distribution below shows how unevenly the total is spread.
                      </span>
                    </div>

                    <DataTable
                      caption="Value at Risk and Expected Shortfall"
                      columns={[
                        { key: 'l', header: 'Level', numeric: true, render: (r) => formatPercent((r as Var).level, 4) },
                        { key: 'v', header: `Value at Risk (${config.aggregate.unit})`, numeric: true, title: 'The loss that is exceeded with probability 1 − level', render: (r) => formatValue((r as Var).valueAtRisk) },
                        { key: 'e', header: `Expected Shortfall (${config.aggregate.unit})`, numeric: true, title: 'The average loss in the cases that exceed Value at Risk', render: (r) => formatValue((r as Var).expectedShortfall) },
                        { key: 'n', header: 'Trials in the tail', numeric: true, render: (r) => (r as Var).tailCount.toLocaleString('en-US') },
                        { key: 's', header: 'Estimate precision', render: (r) => ((r as Var).varStandardError === null ? '—' : `±${formatValue((r as Var).varStandardError!, 3)}`) },
                      ]}
                      rows={metrics.var as Var[]}
                    />
                    <Notice tone="info" title="What these two figures mean">
                      <p>
                        <strong>Value at Risk</strong> at the 95% level is the loss exceeded in 5% of periods. It is a threshold, and says nothing about how far
                        beyond it losses can go.
                      </p>
                      <p>
                        <strong>Expected Shortfall</strong> is the average loss in exactly those worst cases. It is always at least as large as Value at Risk,
                        and it does respond to how heavy the tail is.
                      </p>
                      <p>{metrics.lossConvention}</p>
                    </Notice>
                    {metrics.var.flatMap((v) => v.warnings).length > 0 && <Notice tone="warning" items={metrics.var.flatMap((v) => v.warnings)} />}
                  </Card>

                  {metrics.exceedance.length > 0 && (
                    <Card title="Probability of exceeding a threshold">
                      <DataTable
                        caption="Threshold exceedance"
                        columns={[
                          { key: 't', header: `Threshold (${config.aggregate.unit})`, numeric: true, render: (r) => formatValue((r as Exc).threshold) },
                          { key: 'p', header: 'Probability of exceeding', numeric: true, render: (r) => formatPercent((r as Exc).probability, 4) },
                          { key: 'ci', header: '95% interval', render: (r) => `${formatPercent((r as Exc).low, 3)} – ${formatPercent((r as Exc).high, 3)}` },
                          { key: 'n', header: 'Trials exceeding', numeric: true, render: (r) => (r as Exc).count.toLocaleString('en-US') },
                          { key: 'm', header: 'Average loss when exceeded', numeric: true, render: (r) => (Number.isNaN((r as Exc).conditionalMean) ? 'never exceeded' : formatValue((r as Exc).conditionalMean)) },
                        ]}
                        rows={metrics.exceedance as Exc[]}
                      />
                      <p className="oc-chart-note">
                        A threshold never exceeded in these trials is not impossible: it means the probability is below roughly{' '}
                        {formatPercent(3 / metrics.n, 2)}, which is the smallest value {metrics.n.toLocaleString('en-US')} trials can resolve.
                      </p>
                    </Card>
                  )}

                  {lossCurve && (
                    <Card>
                      <LineChart
                        title="Loss exceedance curve"
                        description="For each loss level, the simulated probability that the total loss exceeds it."
                        series={[{ label: 'Probability of exceeding this loss', points: lossCurve, area: true }]}
                        xLabel={`Total loss (${config.aggregate.unit})`}
                        yLabel="Probability of exceeding"
                        yDomain={[0, 1]}
                        valueFormatter={(v) => formatPercent(v)}
                        referenceLines={config.levels.map((l) => ({ value: 1 - l, label: `${formatPercent(1 - l, 3)} tail`, axis: 'y' as const }))}
                        note="Read a loss level on the horizontal axis to find the chance of exceeding it. The curve becomes unreliable at the far right, where few simulated outcomes contribute."
                        onExport={() => downloadText('exceedance-curve.csv', toCsv(['loss', 'probability_of_exceeding'], lossCurve.map((p) => [p.x, p.y])))}
                      />
                    </Card>
                  )}

                  {(() => {
                    const out = run.state.result!.outputs.find((o) => o.spec.key === 'total');
                    if (!out) return null;
                    return (
                      <Card>
                        <HistogramChart
                          title="Distribution of total loss"
                          description="Histogram of simulated total losses, with Value at Risk marked."
                          bins={out.histogram}
                          xLabel={`Total loss (${config.aggregate.unit})`}
                          markers={metrics.var.map((v) => ({ x: v.valueAtRisk, label: `VaR ${formatPercent(v.level, 3)}` }))}
                          note="Most of the probability sits at modest losses, with a long right tail. The tail is what the risk figures above are about."
                        />
                      </Card>
                    );
                  })()}

                  {(() => {
                    const out = run.state.result!.outputs.find((o) => o.spec.key === 'total');
                    return out ? <Card title="Full statistics"><OutputSummary output={out} result={run.state.result!} /></Card> : null;
                  })()}

                  <Card title="Comparison with a normal approximation" variant="inset">
                    {(() => {
                      const sd = Math.sqrt(Math.max(0, varianceOf(run.state.result!, 'total')));
                      const level = config.levels[config.levels.length - 1] ?? 0.95;
                      const approx = parametricNormalRisk(metrics.expectedLoss, sd || 1, level);
                      const actual = metrics.var.find((v) => v.level === level);
                      if (!actual) return null;
                      const ratio = approx.valueAtRisk !== 0 ? actual.valueAtRisk / approx.valueAtRisk : NaN;
                      return (
                        <>
                          <DataTable
                            caption="Simulated against normal approximation"
                            columns={[
                              { key: 'k', header: '', render: (r) => (r as KV).k },
                              { key: 'v', header: 'Value', numeric: true, render: (r) => (r as KV).v },
                            ]}
                            rows={[
                              { k: `Simulated Value at Risk (${formatPercent(level, 3)})`, v: formatValue(actual.valueAtRisk) },
                              { k: 'If losses were normally distributed', v: formatValue(approx.valueAtRisk) },
                              { k: 'Ratio', v: Number.isFinite(ratio) ? formatValue(ratio, 3) : '—' },
                            ] as KV[]}
                          />
                          <p className="oc-chart-note">
                            {Number.isFinite(ratio) && ratio > 1.15
                              ? 'The simulated figure is substantially larger than the normal approximation, because the loss distribution has a heavier right tail than a normal distribution. Treating losses as normal would understate the risk here.'
                              : 'The two are close, so a normal approximation would not be badly misleading for this model at this level — though that can change at more extreme levels.'}
                          </p>
                        </>
                      );
                    })()}
                  </Card>

                  <AssumptionsPanel assumptions={run.state.result.assumptions} limitations={metrics.limitations} title="Model assumptions and what these figures cannot capture" />
                </>
              )}
            </>
          )}

          {config.mode === 'register' && registerResult && (
            <>
              {!registerResult.ok && <Notice tone="error">{registerResult.error}</Notice>}
              {registerResult.ok && (
                <>
                  <Card title="Expected loss summary">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Total expected loss across all risks</span>
                      <span className="oc-result-hero__value">{formatValue(registerResult.value.totalExpectedLoss)}</span>
                      <span className="oc-result-hero__detail">
                        Probability at least one risk occurs: {formatPercent(registerResult.value.probabilityAtLeastOne, 4)}{' '}
                        {registerResult.value.independenceAssumed ? '(assuming the risks are independent)' : '(an upper bound, making no independence assumption)'}
                      </span>
                    </div>
                    <DataTable
                      caption="Risk register"
                      columns={[
                        { key: 'l', header: 'Risk', render: (r) => (r as Reg).entry.label },
                        { key: 'p', header: 'Probability', numeric: true, render: (r) => <>{formatPercent((r as Reg).entry.probability, 3)} {(r as Reg).entry.probabilitySource === 'estimate' ? <Badge variant="assumed">estimate</Badge> : null}</> },
                        { key: 'i', header: 'Impact', numeric: true, render: (r) => formatValue((r as Reg).entry.impact) },
                        { key: 'e', header: 'Expected loss', numeric: true, render: (r) => formatValue((r as Reg).expectedLoss) },
                        { key: 's', header: 'Share of total', numeric: true, render: (r) => formatPercent((r as Reg).share, 3) },
                        { key: 'm', header: 'With mitigation', numeric: true, render: (r) => ((r as Reg).mitigatedExpectedLoss === null ? '—' : formatValue((r as Reg).mitigatedExpectedLoss!)) },
                        { key: 'n', header: 'Net benefit of mitigating', numeric: true, title: 'Expected loss avoided minus the cost of the mitigation', render: (r) => ((r as Reg).netBenefit === null ? '—' : formatValue((r as Reg).netBenefit!)) },
                      ]}
                      rows={registerResult.value.entries as Reg[]}
                    />
                  </Card>

                  <Card title="Which risks carry the most expected loss">
                    <div className="oc-stack--tight">
                      {registerResult.value.entries.map((e) => (
                        <div key={e.entry.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 2 }}>
                            <span>{e.entry.label}</span>
                            <span className="tnum">{formatValue(e.expectedLoss)}</span>
                          </div>
                          <div style={{ height: 10, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(0, Math.min(100, e.share * 100))}%`, height: '100%', background: seriesColor(0), borderRadius: 4 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="oc-chart-note">
                      Expected loss is probability × impact. Two risks with the same expected loss can need entirely different responses: a small chance of a
                      very large loss is not the same situation as a near-certain small one.
                    </p>
                  </Card>

                  {registerResult.value.entries.some((e) => e.netBenefit !== null) && (
                    <Card title="Mitigation value">
                      <DataTable
                        caption="Mitigation comparison"
                        columns={[
                          { key: 'r', header: 'Risk', render: (r) => (r as Reg).entry.label },
                          { key: 'm', header: 'Mitigation', render: (r) => (r as Reg).entry.mitigation?.label ?? '—' },
                          { key: 'c', header: 'Cost', numeric: true, render: (r) => ((r as Reg).entry.mitigation ? formatValue((r as Reg).entry.mitigation!.cost) : '—') },
                          { key: 'a', header: 'Expected loss avoided', numeric: true, render: (r) => ((r as Reg).mitigatedExpectedLoss === null ? '—' : formatValue((r as Reg).expectedLoss - (r as Reg).mitigatedExpectedLoss!)) },
                          { key: 'n', header: 'Net benefit', numeric: true, render: (r) => ((r as Reg).netBenefit === null ? '—' : formatValue((r as Reg).netBenefit!)) },
                          { key: 'v', header: 'Worth it on expected value?', render: (r) => ((r as Reg).netBenefit === null ? '—' : (r as Reg).netBenefit! > 0 ? 'Yes' : 'No') },
                        ]}
                        rows={registerResult.value.entries.filter((e) => e.entry.mitigation) as Reg[]}
                      />
                      <p className="oc-chart-note">
                        "Worth it" here means only that the expected loss avoided exceeds the cost. A mitigation that removes a catastrophic tail can be worth
                        buying even at a negative expected value, and one that saves a little on average may not be worth the disruption.
                      </p>
                    </Card>
                  )}

                  <AssumptionsPanel assumptions={[]} limitations={registerResult.value.limitations} title="What this summary assumes" />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface Var {
  level: number;
  valueAtRisk: number;
  expectedShortfall: number;
  tailCount: number;
  varStandardError: number | null;
  warnings: string[];
}
interface Exc {
  threshold: number;
  probability: number;
  low: number;
  high: number;
  count: number;
  conditionalMean: number;
}
interface Reg {
  entry: RiskRegisterEntry;
  expectedLoss: number;
  mitigatedExpectedLoss: number | null;
  netBenefit: number | null;
  share: number;
}
interface KV {
  k: string;
  v: string;
}

function varianceOf(result: { outputs: { spec: { key: string }; summary: { variance: number } }[] }, key: string): number {
  return result.outputs.find((o) => o.spec.key === key)?.summary.variance ?? 0;
}

function RegisterEditor({ config, set }: { config: RiskToolConfig; set(patch: Partial<RiskToolConfig>): void }) {
  const register = config.register;
  const update = (patch: Partial<RiskToolConfig['register']>) => set({ register: { ...register, ...patch } });
  const updateEntry = (id: string, patch: Partial<RiskRegisterEntry>) => update({ entries: register.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

  return (
    <Card title="Risks">
      {register.entries.map((e) => (
        <Card key={e.id} variant="inset">
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField label="Risk" value={e.label} onChange={(label) => updateEntry(e.id, { label })} maxLength={160} />
            </div>
            {register.entries.length > 1 && <Button icon="trash" variant="ghost" title={`Remove ${e.label}`} onClick={() => update({ entries: register.entries.filter((x) => x.id !== e.id) })} />}
          </div>
          <SliderField label="Probability it occurs in the period" value={e.probability} onChange={(probability) => updateEntry(e.id, { probability })} min={0} max={1} step={0.01} />
          <NumberField label="Impact if it occurs" value={e.impact} onChange={(impact) => updateEntry(e.id, { impact })} />
          <SelectField
            label="Where the probability comes from"
            value={e.probabilitySource}
            onChange={(probabilitySource) => updateEntry(e.id, { probabilitySource })}
            options={[
              { value: 'estimate', label: 'A judgement I made' },
              { value: 'data', label: 'Measured from data' },
              { value: 'model', label: 'Calculated from a model' },
            ]}
            hint="Marked in the results so judgements are never presented as measurements."
          />
          <Checkbox
            checked={Boolean(e.mitigation)}
            onChange={(on) => updateEntry(e.id, { mitigation: on ? { label: 'Mitigation', probability: e.probability, impact: e.impact * 0.4, cost: e.impact * 0.05 } : undefined })}
            label="Consider a mitigation"
          />
          {e.mitigation && (
            <>
              <TextField label="Mitigation" value={e.mitigation.label} onChange={(label) => updateEntry(e.id, { mitigation: { ...e.mitigation!, label } })} maxLength={160} />
              <SliderField label="Probability after mitigation" value={e.mitigation.probability} onChange={(probability) => updateEntry(e.id, { mitigation: { ...e.mitigation!, probability } })} min={0} max={1} step={0.01} />
              <NumberField label="Impact after mitigation" value={e.mitigation.impact} onChange={(impact) => updateEntry(e.id, { mitigation: { ...e.mitigation!, impact } })} />
              <NumberField label="Cost of the mitigation" value={e.mitigation.cost} onChange={(cost) => updateEntry(e.id, { mitigation: { ...e.mitigation!, cost } })} min={0} />
            </>
          )}
        </Card>
      ))}
      <Button
        icon="plus"
        size="sm"
        disabled={register.entries.length >= 30}
        onClick={() => update({ entries: [...register.entries, { id: newId(), label: `Risk ${register.entries.length + 1}`, probability: 0.1, probabilitySource: 'estimate', impact: 10000, impactSource: 'estimate' }] })}
      >
        Add a risk
      </Button>
      <hr className="oc-divider" />
      <Checkbox
        checked={register.assumeIndependent}
        onChange={(assumeIndependent) => update({ assumeIndependent })}
        label="Treat the risks as independent"
        description="If unchecked, only an upper bound on the probability that at least one occurs is reported, which makes no assumption about how they relate."
      />
    </Card>
  );
}
