/**
 * Probability basics: representations, complement, odds and relative
 * frequency from observed counts.
 */
import { useMemo } from 'react';
import { describeProbability, relativeFrequency } from '../../engine/probability/basic';
import { clopperPearsonInterval, wilsonInterval } from '../../engine/stats/descriptive';
import { Card, DataTable, Notice, NumberField, ProbabilityField, Segmented } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';
import { BarChart } from '../../ui/charts/charts';

export interface ProbabilityBasicsConfig {
  mode: 'value' | 'frequency';
  probability: number;
  successes: number;
  trials: number;
}

export const PROBABILITY_BASICS_DEFAULT: ProbabilityBasicsConfig = { mode: 'value', probability: 0.25, successes: 7, trials: 20 };

export function ProbabilityBasicsTool({ config }: { config: ProbabilityBasicsConfig }) {
  const app = useApp();
  const set = (patch: Partial<ProbabilityBasicsConfig>) => app.updateConfig({ ...config, ...patch });

  const valueResult = useMemo(() => {
    try {
      return { ok: true as const, value: describeProbability({ p: config.probability }) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config.probability]);

  const freqResult = useMemo(() => {
    if (config.mode !== 'frequency') return null;
    try {
      const r = relativeFrequency({ successes: config.successes, trials: config.trials });
      return {
        ok: true as const,
        value: r,
        wilson: wilsonInterval(config.successes, config.trials),
        exact: clopperPearsonInterval(config.successes, config.trials),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config.mode, config.successes, config.trials]);

  const p = config.mode === 'frequency' && freqResult?.ok ? freqResult.value.estimate.p : config.probability;
  const described = config.mode === 'frequency' && freqResult?.ok ? describeProbability({ p }) : valueResult.ok ? valueResult.value : null;

  return (
    <>
      <ToolHeader toolId="probability-basics" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Input">
            <div style={{ marginBottom: 'var(--s4)' }}>
              <Segmented
                label="How the probability is supplied"
                value={config.mode}
                onChange={(mode) => set({ mode })}
                options={[
                  { value: 'value', label: 'A known value' },
                  { value: 'frequency', label: 'From observations' },
                ]}
              />
            </div>
            {config.mode === 'value' ? (
              <ProbabilityField
                label="Probability"
                symbol="P(A)"
                value={config.probability}
                onChange={(probability) => set({ probability })}
                hint="Enter a decimal (0.25), a percentage (25%) or a fraction (1/4). All three are the same number."
              />
            ) : (
              <>
                <NumberField label="Number of successes" value={config.successes} onChange={(successes) => set({ successes })} min={0} max={config.trials} integer />
                <NumberField label="Number of observations" value={config.trials} onChange={(trials) => set({ trials })} min={1} max={1e9} integer hint="How many times the process was observed." />
              </>
            )}
          </Card>
          <AiAssistPanel capability="explainResult" context="The panel beneath the result already shows the method, the formula and every substituted value." />
        </div>

        <div className="oc-stack">
          {!valueResult.ok && config.mode === 'value' && <Notice tone="error">{valueResult.error}</Notice>}
          {freqResult && !freqResult.ok && <Notice tone="error">{freqResult.error}</Notice>}

          {described && (
            <>
              <Card title="The probability in every form">
                <div className="oc-result-hero" style={{ marginBottom: 'var(--s4)' }}>
                  <span className="oc-result-hero__label">Probability of the event</span>
                  <span className="oc-result-hero__value">{described.probability.percent}</span>
                  <span className="oc-result-hero__detail">
                    {formatValue(described.probability.p, 8)}
                    {described.probability.fraction ? ` · ${described.probability.fraction}` : ''}
                    {described.probability.oneIn ? ` · ${described.probability.oneIn}` : ''}
                  </span>
                </div>

                <DataTable
                  caption="Equivalent representations"
                  columns={[
                    { key: 'form', header: 'Form', render: (r) => (r as Row).form },
                    { key: 'event', header: 'The event happens', numeric: true, render: (r) => (r as Row).happens },
                    { key: 'not', header: 'It does not happen', numeric: true, render: (r) => (r as Row).notHappens },
                  ]}
                  rows={
                    [
                      { form: 'Decimal', happens: formatValue(described.probability.p, 8), notHappens: formatValue(described.complement.p, 8) },
                      { form: 'Percentage', happens: described.probability.percent, notHappens: described.complement.percent },
                      {
                        form: 'Fraction',
                        happens: described.probability.fraction ?? 'not a short fraction',
                        notHappens: described.complement.fraction ?? 'not a short fraction',
                      },
                      { form: 'Odds (for : against)', happens: described.oddsFor, notHappens: described.oddsAgainst },
                      { form: '"1 in N"', happens: described.probability.oneIn ?? '—', notHappens: described.complement.oneIn ?? '—' },
                    ] as Row[]
                  }
                />

                <Notice tone="info" title="Reading a probability correctly">
                  <p>
                    A probability of {described.probability.percent} does not mean that the event occurs exactly once in every{' '}
                    {described.probability.oneIn?.replace('about 1 in ', '') ?? 'N'} attempts. It is the long-run frequency over many repetitions, or a degree of
                    belief. In any particular run of attempts the count will usually differ, sometimes considerably.
                  </p>
                </Notice>
              </Card>

              <Card>
                <BarChart
                  title="The two outcomes"
                  description={`Bar chart comparing the probability of the event (${described.probability.percent}) with the probability that it does not occur (${described.complement.percent}).`}
                  data={[
                    { x: 0, y: described.probability.p, label: 'Happens' },
                    { x: 1, y: described.complement.p, label: 'Does not happen' },
                  ]}
                  xLabel="Outcome"
                  yLabel="Probability"
                  seriesLabel="Probability"
                  asPercent
                  height={200}
                  note="The two bars always sum to 1: either the event happens or it does not."
                />
              </Card>

              {config.mode === 'frequency' && freqResult?.ok && (
                <Card title="This is an estimate, not an exact probability">
                  {freqResult.value.warnings.length > 0 && <Notice tone="warning" items={freqResult.value.warnings} />}
                  <div className="oc-figure-grid">
                    <div className="oc-figure">
                      <span className="oc-figure__label">Observed proportion</span>
                      <div className="oc-figure__value">{formatPercent(freqResult.value.estimate.p)}</div>
                      <div className="oc-figure__sub">
                        {config.successes} of {config.trials}
                      </div>
                    </div>
                    <div className="oc-figure">
                      <span className="oc-figure__label">95% interval (Wilson)</span>
                      <div className="oc-figure__value" style={{ fontSize: 15 }}>
                        {formatPercent(freqResult.wilson.low)} – {formatPercent(freqResult.wilson.high)}
                      </div>
                      <div className="oc-figure__sub">Recommended for most purposes</div>
                    </div>
                    <div className="oc-figure">
                      <span className="oc-figure__label">95% interval (exact)</span>
                      <div className="oc-figure__value" style={{ fontSize: 15 }}>
                        {formatPercent(freqResult.exact.low)} – {formatPercent(freqResult.exact.high)}
                      </div>
                      <div className="oc-figure__sub">Clopper–Pearson; wider, and conservative</div>
                    </div>
                  </div>
                  <p className="oc-chart-note">
                    Both intervals give the range of true probabilities consistent with what you observed, at the 95% level. The Wilson interval is accurate for
                    most counts, including near 0 and 1. The Clopper–Pearson interval guarantees at least 95% coverage but is wider as a result.
                  </p>
                  <ExplanationPanel explanation={freqResult.value.explanation} />
                </Card>
              )}

              <ExplanationPanel explanation={described.explanation} defaultOpen={config.mode === 'value'} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface Row {
  form: string;
  happens: string;
  notHappens: string;
}
