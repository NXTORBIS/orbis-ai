/**
 * Bayes' theorem: a general multi-hypothesis view and a diagnostic-test view.
 */
import { useMemo } from 'react';
import { bayes, diagnostic, type BayesHypothesis } from '../../engine/probability/basic';
import { Button, Card, DataTable, Notice, ProbabilityField, Segmented, TextField } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { BarChart } from '../../ui/charts/charts';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';
import { Icon } from '../../ui/icons';

export interface BayesConfig {
  mode: 'hypotheses' | 'diagnostic';
  hypotheses: { label: string; prior: number; likelihood: number }[];
  evidenceName: string;
  prevalence: number;
  sensitivity: number;
  specificity: number;
}

export const BAYES_DEFAULT: BayesConfig = {
  mode: 'diagnostic',
  hypotheses: [
    { label: 'Hypothesis is true', prior: 0.3, likelihood: 0.8 },
    { label: 'Hypothesis is false', prior: 0.7, likelihood: 0.1 },
  ],
  evidenceName: 'the observed evidence',
  prevalence: 0.01,
  sensitivity: 0.99,
  specificity: 0.99,
};

export function BayesTool({ config }: { config: BayesConfig }) {
  const app = useApp();
  const set = (patch: Partial<BayesConfig>) => app.updateConfig({ ...config, ...patch });

  const hypothesesResult = useMemo(() => {
    if (config.mode !== 'hypotheses') return null;
    try {
      return { ok: true as const, value: bayes(config.hypotheses as BayesHypothesis[]) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config.mode, config.hypotheses]);

  const diagnosticResult = useMemo(() => {
    if (config.mode !== 'diagnostic') return null;
    try {
      return { ok: true as const, value: diagnostic({ prevalence: config.prevalence, sensitivity: config.sensitivity, specificity: config.specificity }) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config.mode, config.prevalence, config.sensitivity, config.specificity]);

  const priorSum = config.hypotheses.reduce((a, h) => a + h.prior, 0);

  return (
    <>
      <ToolHeader toolId="bayes" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Setup">
            <div style={{ marginBottom: 'var(--s4)' }}>
              <Segmented
                label="Which view"
                value={config.mode}
                onChange={(mode) => set({ mode })}
                options={[
                  { value: 'diagnostic', label: 'Test accuracy' },
                  { value: 'hypotheses', label: 'General hypotheses' },
                ]}
              />
            </div>

            {config.mode === 'diagnostic' ? (
              <>
                <ProbabilityField
                  label="Base rate in the population tested"
                  symbol="prevalence"
                  value={config.prevalence}
                  onChange={(prevalence) => set({ prevalence })}
                  hint="The share of the tested population that actually has the condition, before any testing."
                />
                <ProbabilityField
                  label="Sensitivity"
                  symbol="P(positive | has it)"
                  value={config.sensitivity}
                  onChange={(sensitivity) => set({ sensitivity })}
                  hint="Among those who have the condition, the share the test correctly identifies."
                />
                <ProbabilityField
                  label="Specificity"
                  symbol="P(negative | does not have it)"
                  value={config.specificity}
                  onChange={(specificity) => set({ specificity })}
                  hint="Among those who do not have the condition, the share the test correctly clears."
                />
                <Notice tone="warning" title="This is a probability calculation, not medical advice">
                  <p>
                    The numbers below follow from the three values you entered and nothing else. Real interpretation of a test result depends on clinical
                    context, the quality of the test in that specific population, and factors this model does not contain.
                  </p>
                </Notice>
              </>
            ) : (
              <>
                <TextField label="What was observed" value={config.evidenceName} onChange={(evidenceName) => set({ evidenceName })} maxLength={120} hint="Used in the labels below." />
                {config.hypotheses.map((h, i) => (
                  <Card key={i} variant="inset">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
                      <strong style={{ fontSize: 12.5, flex: 1 }}>Hypothesis {i + 1}</strong>
                      {config.hypotheses.length > 2 && (
                        <Button
                          icon="trash"
                          size="sm"
                          variant="ghost"
                          title={`Remove hypothesis ${i + 1}`}
                          onClick={() => set({ hypotheses: config.hypotheses.filter((_, j) => j !== i) })}
                        />
                      )}
                    </div>
                    <TextField
                      label="Name"
                      value={h.label}
                      onChange={(label) => set({ hypotheses: config.hypotheses.map((x, j) => (j === i ? { ...x, label } : x)) })}
                      maxLength={120}
                    />
                    <ProbabilityField
                      label="Prior probability"
                      symbol="P(H)"
                      value={h.prior}
                      onChange={(prior) => set({ hypotheses: config.hypotheses.map((x, j) => (j === i ? { ...x, prior } : x)) })}
                    />
                    <ProbabilityField
                      label={`Probability of ${config.evidenceName} if this is true`}
                      symbol="P(E | H)"
                      value={h.likelihood}
                      onChange={(likelihood) => set({ hypotheses: config.hypotheses.map((x, j) => (j === i ? { ...x, likelihood } : x)) })}
                    />
                  </Card>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, color: Math.abs(priorSum - 1) > 1e-9 ? 'var(--status-warning)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
                    {Math.abs(priorSum - 1) > 1e-9 && <Icon name="alert" size={12} />}
                    Priors sum to {formatValue(priorSum, 6)}
                    {Math.abs(priorSum - 1) > 1e-9 ? ' — they must sum to 1' : ''}
                  </span>
                  <Button
                    icon="plus"
                    size="sm"
                    disabled={config.hypotheses.length >= 10}
                    onClick={() => set({ hypotheses: [...config.hypotheses, { label: `Hypothesis ${config.hypotheses.length + 1}`, prior: 0, likelihood: 0.5 }] })}
                  >
                    Add hypothesis
                  </Button>
                </div>
              </>
            )}
          </Card>

          <AiAssistPanel capability="draftAssumptions" context="The explanation panel lists the assumptions this calculation makes, and the Details dialog lets you record your own." />
        </div>

        <div className="oc-stack">
          {config.mode === 'diagnostic' && diagnosticResult && (
            <>
              {!diagnosticResult.ok && <Notice tone="error">{diagnosticResult.error}</Notice>}
              {diagnosticResult.ok && (
                <>
                  <Card title="After a positive result">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Probability the condition is actually present</span>
                      <span className="oc-result-hero__value">{formatPercent(diagnosticResult.value.positivePredictiveValue, 4)}</span>
                      <span className="oc-result-hero__detail">
                        Started from a base rate of {formatPercent(config.prevalence, 4)}; the positive result multiplied the odds by{' '}
                        {formatValue((config.sensitivity / (1 - config.specificity)) || NaN, 4)}.
                      </span>
                    </div>
                    <div className="oc-figure-grid" style={{ marginTop: 'var(--s4)' }}>
                      <Fig label="After a negative result, condition absent" value={formatPercent(diagnosticResult.value.negativePredictiveValue, 5)} />
                      <Fig label="Chance of testing positive at all" value={formatPercent(diagnosticResult.value.probabilityOfPositiveTest, 4)} />
                      <Fig label="False positive rate" value={formatPercent(diagnosticResult.value.falsePositiveRate, 4)} sub="1 − specificity" />
                      <Fig label="False negative rate" value={formatPercent(diagnosticResult.value.falseNegativeRate, 4)} sub="1 − sensitivity" />
                    </div>
                  </Card>

                  <Card title="Out of 100,000 people tested" hint="The same calculation expressed as counts, which is often easier to judge.">
                    <DataTable
                      caption="Expected counts per 100,000 people tested"
                      columns={[
                        { key: 'g', header: '', render: (r) => (r as Count).group },
                        { key: 'pos', header: 'Test positive', numeric: true, render: (r) => Math.round((r as Count).positive).toLocaleString('en-US') },
                        { key: 'neg', header: 'Test negative', numeric: true, render: (r) => Math.round((r as Count).negative).toLocaleString('en-US') },
                        { key: 'tot', header: 'Total', numeric: true, render: (r) => Math.round((r as Count).positive + (r as Count).negative).toLocaleString('en-US') },
                      ]}
                      rows={[
                        { group: 'Has the condition', positive: diagnosticResult.value.per100k.truePositive, negative: diagnosticResult.value.per100k.falseNegative },
                        { group: 'Does not have it', positive: diagnosticResult.value.per100k.falsePositive, negative: diagnosticResult.value.per100k.trueNegative },
                      ] as Count[]}
                    />
                    <p className="oc-chart-note">
                      Of every{' '}
                      {Math.round(diagnosticResult.value.per100k.truePositive + diagnosticResult.value.per100k.falsePositive).toLocaleString('en-US')} positive
                      results, about {Math.round(diagnosticResult.value.per100k.truePositive).toLocaleString('en-US')} are correct and{' '}
                      {Math.round(diagnosticResult.value.per100k.falsePositive).toLocaleString('en-US')} are false alarms. When the condition is rare, false
                      alarms can outnumber true cases even with a highly accurate test — that is the base-rate effect.
                    </p>
                  </Card>

                  <Card>
                    <BarChart
                      title="Where a positive result comes from"
                      description="Comparison of true positives and false positives per 100,000 people tested."
                      data={[
                        { x: 0, y: diagnosticResult.value.per100k.truePositive, label: 'True positives' },
                        { x: 1, y: diagnosticResult.value.per100k.falsePositive, label: 'False positives' },
                      ]}
                      xLabel="Source of a positive result"
                      yLabel="People per 100,000"
                      seriesLabel="People"
                      height={210}
                    />
                  </Card>

                  <ExplanationPanel explanation={diagnosticResult.value.explanation} defaultOpen />
                </>
              )}
            </>
          )}

          {config.mode === 'hypotheses' && hypothesesResult && (
            <>
              {!hypothesesResult.ok && <Notice tone="error" title="The hypotheses are not valid">{hypothesesResult.error}</Notice>}
              {hypothesesResult.ok && (
                <>
                  {hypothesesResult.value.warnings.length > 0 && <Notice tone="info" items={hypothesesResult.value.warnings} />}
                  <Card title="Posterior probabilities">
                    <DataTable
                      caption="Prior and posterior probability of each hypothesis"
                      columns={[
                        { key: 'h', header: 'Hypothesis', render: (r) => (r as Post).label },
                        { key: 'prior', header: 'Prior', numeric: true, render: (r) => formatPercent((r as Post).prior, 4) },
                        { key: 'like', header: 'P(evidence | H)', numeric: true, render: (r) => formatValue((r as Post).likelihood, 5) },
                        { key: 'post', header: 'Posterior', numeric: true, render: (r) => formatPercent((r as Post).posterior, 4) },
                        {
                          key: 'change',
                          header: 'Change',
                          numeric: true,
                          render: (r) => {
                            const d = (r as Post).posterior - (r as Post).prior;
                            return `${d >= 0 ? '+' : '−'}${formatPercent(Math.abs(d), 3)}`;
                          },
                        },
                        { key: 'bf', header: 'Bayes factor', numeric: true, title: 'How strongly the evidence favours this hypothesis over all the others combined', render: (r) => ((r as Post).bayesFactor === null ? '—' : formatValue((r as Post).bayesFactor!, 4)) },
                      ]}
                      rows={hypothesesResult.value.posteriors as Post[]}
                    />
                    <p className="oc-chart-note">
                      Probability of the evidence overall: P(E) = {formatValue(hypothesesResult.value.evidenceProbability, 6)}. A Bayes factor above 1 means the
                      evidence favours that hypothesis relative to the others; the posterior also depends on how likely it was to begin with.
                    </p>
                  </Card>

                  <Card>
                    <BarChart
                      title="Prior and posterior compared"
                      description="For each hypothesis, the prior probability and the posterior probability after the evidence."
                      data={hypothesesResult.value.posteriors.map((p, i) => ({ x: i, y: p.posterior, compare: p.prior, label: p.label }))}
                      xLabel="Hypothesis"
                      yLabel="Probability"
                      seriesLabel="Posterior (after evidence)"
                      compareLabel="Prior (before evidence)"
                      asPercent
                      note="The prior is shown as a rule across each bar. Where the bar rises above the rule, the evidence made that hypothesis more likely."
                    />
                  </Card>

                  <ExplanationPanel explanation={hypothesesResult.value.explanation} defaultOpen />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface Count {
  group: string;
  positive: number;
  negative: number;
}

interface Post {
  label: string;
  prior: number;
  likelihood: number;
  posterior: number;
  bayesFactor: number | null;
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="oc-figure">
      <span className="oc-figure__label">{label}</span>
      <div className="oc-figure__value">{value}</div>
      {sub && <div className="oc-figure__sub">{sub}</div>}
    </div>
  );
}
