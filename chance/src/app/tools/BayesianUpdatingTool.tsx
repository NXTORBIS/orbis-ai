/**
 * Bayesian updating with conjugate priors: prior and posterior on one chart,
 * credible intervals, and a predictive statement about the next observation.
 */
import { useMemo } from 'react';
import { updateBayesian, type BayesianInput, type ConjugateFamily } from '../../engine/probability/bayesian';
import { curve, getDistribution, plotRange } from '../../engine/distributions/registry';
import { Card, DataTable, Notice, NumberField, SelectField, SliderField } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { LineChart } from '../../ui/charts/charts';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

export interface BayesianUpdatingConfig {
  family: ConjugateFamily;
  level: number;
  beta: { priorAlpha: number; priorBeta: number; successes: number; failures: number };
  gamma: { priorShape: number; priorRate: number; events: number; exposure: number };
  normal: { priorMean: number; priorSd: number; observationSd: number; sampleMean: number; sampleSize: number };
}

export const BAYESIAN_UPDATING_DEFAULT: BayesianUpdatingConfig = {
  family: 'beta-binomial',
  level: 0.95,
  beta: { priorAlpha: 1, priorBeta: 1, successes: 7, failures: 3 },
  gamma: { priorShape: 2, priorRate: 1, events: 10, exposure: 4 },
  normal: { priorMean: 100, priorSd: 15, observationSd: 10, sampleMean: 112, sampleSize: 9 },
};

const FAMILIES: { value: ConjugateFamily; label: string; what: string }[] = [
  { value: 'beta-binomial', label: 'Unknown probability (Beta–Binomial)', what: 'A success rate or proportion, learned from counts of successes and failures.' },
  { value: 'gamma-poisson', label: 'Unknown event rate (Gamma–Poisson)', what: 'A rate of events per unit of time, area or exposure, learned from observed counts.' },
  { value: 'normal-normal', label: 'Unknown mean (Normal–Normal)', what: 'An average measurement, learned from a sample, where the spread of individual measurements is known.' },
];

export function BayesianUpdatingTool({ config }: { config: BayesianUpdatingConfig }) {
  const app = useApp();
  const set = (patch: Partial<BayesianUpdatingConfig>) => app.updateConfig({ ...config, ...patch });

  const input = useMemo<BayesianInput>(() => {
    switch (config.family) {
      case 'beta-binomial':
        return { family: 'beta-binomial', ...config.beta };
      case 'gamma-poisson':
        return { family: 'gamma-poisson', ...config.gamma };
      case 'normal-normal':
        return { family: 'normal-normal', ...config.normal };
    }
  }, [config]);

  const result = useMemo(() => {
    try {
      return { ok: true as const, value: updateBayesian(input, config.level) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [input, config.level]);

  const chart = useMemo(() => {
    if (!result.ok) return null;
    const post = getDistribution(result.value.distributionId);
    const prior = getDistribution(result.value.prior.distributionId);
    try {
      const rPost = plotRange(post, result.value.params);
      const rPrior = plotRange(prior, result.value.prior.params);
      const range = { min: Math.min(rPost.min, rPrior.min), max: Math.max(rPost.max, rPrior.max) };
      return {
        prior: curve(prior, result.value.prior.params, range, 320).map((p) => ({ x: p.x, y: p.pdf })),
        posterior: curve(post, result.value.params, range, 320).map((p) => ({ x: p.x, y: p.pdf })),
      };
    } catch {
      return null;
    }
  }, [result]);

  const familyInfo = FAMILIES.find((f) => f.value === config.family)!;
  const quantityName = config.family === 'beta-binomial' ? 'probability' : config.family === 'gamma-poisson' ? 'rate' : 'mean';

  return (
    <>
      <ToolHeader toolId="bayesian-updating" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What are you estimating?">
            <SelectField label="Unknown quantity" value={config.family} onChange={(family) => set({ family })} options={FAMILIES.map((f) => ({ value: f.value, label: f.label }))} hint={familyInfo.what} />
            <SliderField label="Credible level" value={config.level} onChange={(level) => set({ level })} min={0.5} max={0.999} step={0.005} hint="The share of posterior probability the interval contains." />
          </Card>

          {config.family === 'beta-binomial' && (
            <>
              <Card title="Prior belief" hint="What you believed about the probability before the data.">
                <NumberField label="Prior α" value={config.beta.priorAlpha} onChange={(priorAlpha) => set({ beta: { ...config.beta, priorAlpha } })} min={0.001} max={1e6} hint="Behaves like a count of prior successes." />
                <NumberField label="Prior β" value={config.beta.priorBeta} onChange={(priorBeta) => set({ beta: { ...config.beta, priorBeta } })} min={0.001} max={1e6} hint="Behaves like a count of prior failures." />
                <Notice tone="info" title="Common choices">
                  <ul>
                    <li>α = β = 1: every probability equally likely (uniform).</li>
                    <li>α = β = 0.5: Jeffreys' prior, which gives slightly more weight to extremes.</li>
                    <li>α = β = large: a strong belief that the probability is near one half.</li>
                  </ul>
                </Notice>
              </Card>
              <Card title="Observed data">
                <NumberField label="Successes" value={config.beta.successes} onChange={(successes) => set({ beta: { ...config.beta, successes } })} min={0} max={1e9} integer />
                <NumberField label="Failures" value={config.beta.failures} onChange={(failures) => set({ beta: { ...config.beta, failures } })} min={0} max={1e9} integer />
              </Card>
            </>
          )}

          {config.family === 'gamma-poisson' && (
            <>
              <Card title="Prior belief about the rate">
                <NumberField label="Prior shape" value={config.gamma.priorShape} onChange={(priorShape) => set({ gamma: { ...config.gamma, priorShape } })} min={0.001} max={1e6} hint="Behaves like a count of prior events." />
                <NumberField label="Prior rate" value={config.gamma.priorRate} onChange={(priorRate) => set({ gamma: { ...config.gamma, priorRate } })} min={0.001} max={1e6} hint="Behaves like a prior exposure. Prior mean rate = shape ÷ rate." />
              </Card>
              <Card title="Observed data">
                <NumberField label="Events observed" value={config.gamma.events} onChange={(events) => set({ gamma: { ...config.gamma, events } })} min={0} max={1e9} integer />
                <NumberField label="Exposure" value={config.gamma.exposure} onChange={(exposure) => set({ gamma: { ...config.gamma, exposure } })} min={0} max={1e9} hint="Time, area or number of units over which those events were counted." />
              </Card>
            </>
          )}

          {config.family === 'normal-normal' && (
            <>
              <Card title="Prior belief about the mean">
                <NumberField label="Prior mean" value={config.normal.priorMean} onChange={(priorMean) => set({ normal: { ...config.normal, priorMean } })} />
                <NumberField label="Prior standard deviation" value={config.normal.priorSd} onChange={(priorSd) => set({ normal: { ...config.normal, priorSd } })} min={0.0001} hint="How uncertain you were about the mean. Larger means a weaker prior." />
              </Card>
              <Card title="Observed data">
                <NumberField label="Sample mean" value={config.normal.sampleMean} onChange={(sampleMean) => set({ normal: { ...config.normal, sampleMean } })} />
                <NumberField label="Sample size" value={config.normal.sampleSize} onChange={(sampleSize) => set({ normal: { ...config.normal, sampleSize } })} min={0} max={1e9} integer />
                <NumberField
                  label="Standard deviation of a single measurement"
                  value={config.normal.observationSd}
                  onChange={(observationSd) => set({ normal: { ...config.normal, observationSd } })}
                  min={0.0001}
                  hint="Treated as known. If it was estimated from the same data, the interval below is narrower than it should be."
                />
              </Card>
            </>
          )}

          <AiAssistPanel capability="explainUncertainty" context="The credible interval and its interpretation are stated beneath the result, along with what distinguishes it from a confidence interval." />
        </div>

        <div className="oc-stack">
          {!result.ok && <Notice tone="error">{result.error}</Notice>}
          {result.ok && (
            <>
              {result.value.warnings.length > 0 && <Notice tone="info" items={result.value.warnings} />}

              <Card title={`Posterior belief about the ${quantityName}`}>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">Posterior mean</span>
                  <span className="oc-result-hero__value">{config.family === 'beta-binomial' ? formatPercent(result.value.mean, 5) : formatValue(result.value.mean, 6)}</span>
                  <span className="oc-result-hero__detail">
                    {(config.level * 100).toFixed(1)}% credible interval:{' '}
                    {config.family === 'beta-binomial'
                      ? `${formatPercent(result.value.credibleInterval.low, 4)} to ${formatPercent(result.value.credibleInterval.high, 4)}`
                      : `${formatValue(result.value.credibleInterval.low, 6)} to ${formatValue(result.value.credibleInterval.high, 6)}`}
                  </span>
                  <span className="oc-result-hero__detail oc-muted">
                    Given this prior and this model, there is a {(config.level * 100).toFixed(1)}% posterior probability that the {quantityName} lies in that
                    interval. A confidence interval makes a different kind of statement — about the procedure, not about this particular interval.
                  </span>
                </div>

                <DataTable
                  caption="Prior and posterior compared"
                  columns={[
                    { key: 'q', header: '', render: (r) => (r as Row).q },
                    { key: 'prior', header: 'Before the data', numeric: true, render: (r) => (r as Row).prior },
                    { key: 'post', header: 'After the data', numeric: true, render: (r) => (r as Row).post },
                  ]}
                  rows={
                    [
                      { q: 'Mean', prior: formatValue(result.value.prior.mean, 6), post: formatValue(result.value.mean, 6) },
                      { q: 'Standard deviation', prior: formatValue(result.value.prior.sd, 6), post: formatValue(result.value.sd, 6) },
                      { q: 'Mode', prior: '—', post: result.value.mode === null ? 'undefined' : formatValue(result.value.mode, 6) },
                      {
                        q: 'Uncertainty reduced by',
                        prior: '—',
                        post: result.value.prior.sd > 0 ? formatPercent(1 - result.value.sd / result.value.prior.sd, 3) : '—',
                      },
                    ] as Row[]
                  }
                />
              </Card>

              {chart && (
                <Card>
                  <LineChart
                    title="How the data changed your belief"
                    description="The prior and posterior distributions for the unknown quantity, plotted on the same axes."
                    series={[
                      { label: 'Prior (before the data)', points: chart.prior, dashed: true },
                      { label: 'Posterior (after the data)', points: chart.posterior, area: true },
                    ]}
                    xLabel={config.family === 'beta-binomial' ? 'Probability' : config.family === 'gamma-poisson' ? 'Rate' : 'Mean'}
                    yLabel="Probability density"
                    valueFormatter={(v) => formatValue(v, 5)}
                    referenceLines={[
                      { value: result.value.credibleInterval.low, label: `${((1 - config.level) / 2 * 100).toFixed(1)}%`, axis: 'x' },
                      { value: result.value.credibleInterval.high, label: `${((1 - (1 - config.level) / 2) * 100).toFixed(1)}%`, axis: 'x' },
                    ]}
                    note="A narrower, taller posterior means the data were informative. If the two curves look alike, the data added little to what the prior already said."
                  />
                </Card>
              )}

              {result.value.predictive && (
                <Card title="What to expect next" variant="inset">
                  <div className="oc-figure">
                    <span className="oc-figure__label">{result.value.predictive.label}</span>
                    <div className="oc-figure__value">{result.value.predictive.value}</div>
                  </div>
                  <p className="oc-chart-note">{result.value.predictive.detail}</p>
                </Card>
              )}

              <Card title="The prior matters — see for yourself" variant="inset">
                <p style={{ fontSize: 12.5 }}>
                  With this prior the posterior mean is {formatValue(result.value.mean, 6)}. Change the prior above and watch the posterior move: the weaker the
                  data, the more the answer depends on the prior you chose. With plenty of data, different reasonable priors converge to nearly the same
                  posterior.
                </p>
              </Card>

              <ExplanationPanel explanation={result.value.explanation} defaultOpen />
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface Row {
  q: string;
  prior: string;
  post: string;
}
