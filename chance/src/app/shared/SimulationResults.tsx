/**
 * Display of a simulation result: summary statistics, the distribution of
 * outcomes, the empirical cumulative distribution, convergence, and comparison
 * with the exact value where one exists.
 *
 * The distinction the specification calls for is enforced here:
 *  - A *confidence interval* is reported for the estimated expectation or
 *    probability, labelled as describing sampling error in that estimate.
 *  - *Quantiles* of the simulated outcomes are reported separately and
 *    labelled as a range of outcomes, never as a confidence interval.
 */
import { useMemo, useState } from 'react';
import type { OutputResult, SimulationResult } from '../../engine/simulation/types';
import { Badge, Card, DataTable, Notice, Segmented, type ColumnDef } from '../../ui/primitives';
import { BarChart, ConvergenceChart, HistogramChart, LineChart } from '../../ui/charts/charts';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { downloadText, toCsv } from '../../persistence/store';
import { AssumptionsPanel } from './ExplanationPanel';
import { RunProvenance } from './SimulationControls';

export function SimulationResults({ result, title = 'Results' }: { result: SimulationResult; title?: string }) {
  const outputs = result.outputs.filter((o) => o.spec.role !== 'input');
  const [selected, setSelected] = useState(0);
  const output = outputs[Math.min(selected, outputs.length - 1)];
  if (!output) return null;
  return (
    <div className="oc-stack">
      {result.warnings.length > 0 && <Notice tone="warning" title="About this run" items={result.warnings} />}

      {outputs.length > 1 && (
        <Segmented
          label="Output to display"
          value={String(Math.min(selected, outputs.length - 1))}
          onChange={(v) => setSelected(Number(v))}
          options={outputs.map((o, i) => ({ value: String(i), label: o.spec.label }))}
        />
      )}

      <Card title={title}>
        <OutputSummary output={output} result={result} />
      </Card>

      <OutputCharts output={output} result={result} />

      <AssumptionsPanel
        assumptions={result.assumptions}
        limitations={[
          'A simulation describes the model it was given. If the model is wrong, more trials produce a more precise answer to the wrong question — they do not correct the model.',
          'Simulated outcomes are not predictions of what will happen. They show what the model implies is possible and how often.',
        ]}
        title="Model assumptions and limitations"
      />
      <RunProvenance result={result} />
    </div>
  );
}

export function OutputSummary({ output, result }: { output: OutputResult; result: SimulationResult }) {
  const s = output.summary;
  const isIndicator = output.spec.kind === 'indicator';
  const unit = output.spec.unit ? ` ${output.spec.unit}` : '';
  const theoretical = output.theoretical;
  const exactValue = isIndicator ? theoretical?.probability ?? theoretical?.mean : theoretical?.mean;

  const quantile = (p: number) => s.quantiles.find((q) => q.p === p)?.value ?? NaN;

  return (
    <div className="oc-stack">
      <div className="oc-result-hero">
        <span className="oc-result-hero__label">
          {isIndicator ? `Estimated probability: ${output.spec.label}` : `Estimated average: ${output.spec.label}`}
        </span>
        <span className="oc-result-hero__value">{isIndicator ? formatPercent(s.mean, 4) : `${formatValue(s.mean)}${unit}`}</span>
        <span className="oc-result-hero__detail">
          95% confidence interval for this {isIndicator ? 'probability' : 'average'}: {isIndicator ? formatPercent(output.estimateInterval.low, 4) : formatValue(output.estimateInterval.low)} to{' '}
          {isIndicator ? formatPercent(output.estimateInterval.high, 4) : formatValue(output.estimateInterval.high)}
          {' · '}
          <span className="oc-muted">{output.estimateInterval.method}</span>
        </span>
        <span className="oc-result-hero__detail oc-muted">
          This interval describes how precisely {result.trialsCompleted.toLocaleString('en-US')} trials pin down the model's own{' '}
          {isIndicator ? 'probability' : 'expected value'}. It is not the range of individual outcomes — that is shown below.
        </span>
      </div>

      {output.warnings.length > 0 && <Notice tone="warning" items={output.warnings} />}

      {exactValue !== undefined && Number.isFinite(exactValue) && (
        <Notice
          tone={
            Math.abs(s.mean - exactValue) <= 3 * Math.max(s.standardError, 1e-12)
              ? 'success'
              : 'warning'
          }
          title="Comparison with the exact value"
        >
          <p>
            The exact value is <strong>{isIndicator ? formatPercent(exactValue, 6) : formatValue(exactValue)}</strong>. The simulation gave{' '}
            {isIndicator ? formatPercent(s.mean, 6) : formatValue(s.mean)}, a difference of {formatValue(Math.abs(s.mean - exactValue), 3)} ({
              s.standardError > 0 ? `${(Math.abs(s.mean - exactValue) / s.standardError).toFixed(2)} standard errors` : 'standard error unavailable'
            }).
          </p>
          <p className="oc-muted">{theoretical?.source}</p>
        </Notice>
      )}

      <div className="oc-figure-grid">
        <Figure label="Trials" value={s.n.toLocaleString('en-US')} />
        {!isIndicator && <Figure label="Median outcome" value={`${formatValue(s.median)}${unit}`} sub="Half the outcomes fall below this" />}
        {!isIndicator && <Figure label="Standard deviation" value={formatValue(s.sd)} sub="Spread of individual outcomes" />}
        <Figure label="Smallest simulated" value={`${formatValue(s.min)}${unit}`} />
        <Figure label="Largest simulated" value={`${formatValue(s.max)}${unit}`} />
        {!isIndicator && Number.isFinite(s.skewness) && <Figure label="Skewness" value={formatValue(s.skewness, 3)} sub={s.skewness > 0.5 ? 'Long right tail' : s.skewness < -0.5 ? 'Long left tail' : 'Roughly symmetric'} />}
      </div>

      {!isIndicator && (
        <Card title="Range of simulated outcomes" variant="inset" hint="These are percentiles of the individual outcomes, not a confidence interval for an unknown quantity.">
          <div className="oc-figure-grid">
            <Figure label="5th percentile" value={`${formatValue(quantile(0.05))}${unit}`} sub="5% of outcomes were below this" />
            <Figure label="25th percentile" value={`${formatValue(quantile(0.25))}${unit}`} />
            <Figure label="75th percentile" value={`${formatValue(quantile(0.75))}${unit}`} />
            <Figure label="95th percentile" value={`${formatValue(quantile(0.95))}${unit}`} sub="5% of outcomes were above this" />
          </div>
          <p className="oc-chart-note">
            90% of the simulated outcomes fell between {formatValue(quantile(0.05))} and {formatValue(quantile(0.95))}
            {unit}. That is a statement about the spread of outcomes the model produces, which is a different question from how precisely the average is known.
          </p>
        </Card>
      )}

      {output.nonFinite > 0 && (
        <Notice tone="warning" title="Some trials produced no usable value">
          <p>
            {output.nonFinite.toLocaleString('en-US')} trial(s) gave a value that is not a finite number and were excluded from these statistics. This usually
            means a division by zero or an out-of-range parameter in those trials.
          </p>
        </Notice>
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="oc-figure">
      <span className="oc-figure__label">{label}</span>
      <div className="oc-figure__value">{value}</div>
      {sub && <div className="oc-figure__sub">{sub}</div>}
    </div>
  );
}

export function OutputCharts({ output, result }: { output: OutputResult; result: SimulationResult }) {
  const unit = output.spec.unit ? ` (${output.spec.unit})` : '';
  const isIndicator = output.spec.kind === 'indicator';

  const exportHistogram = () => {
    const rows = output.histogram.map((b) => [b.x0, b.x1, b.count, b.proportion, b.density]);
    downloadText(`${output.spec.key}-histogram.csv`, toCsv(['bin_start', 'bin_end', 'count', 'proportion', 'density'], rows));
  };
  const exportFrequencies = () => {
    const rows = (output.frequencies ?? []).map((f) => [f.value, f.count, f.proportion]);
    downloadText(`${output.spec.key}-frequencies.csv`, toCsv(['value', 'count', 'proportion'], rows));
  };
  const exportConvergence = () => {
    const rows = output.convergence.map((c) => [c.n, c.estimate, c.low, c.high]);
    downloadText(`${output.spec.key}-convergence.csv`, toCsv(['trials', 'estimate', 'ci_low', 'ci_high'], rows));
  };

  const ecdfSeries = useMemo(() => [{ label: 'Share of outcomes at or below this value', points: output.ecdf.map((p) => ({ x: p.x, y: p.p })) }], [output.ecdf]);

  const frequencyColumns: ColumnDef<unknown>[] = [
    { key: 'v', header: 'Outcome', numeric: true, render: (r) => formatValue((r as { value: number }).value) },
    { key: 'c', header: 'Count', numeric: true, render: (r) => (r as { count: number }).count.toLocaleString('en-US') },
    { key: 'p', header: 'Share', numeric: true, render: (r) => formatPercent((r as { proportion: number }).proportion) },
  ];

  return (
    <div className="oc-stack">
      {isIndicator ? (
        <Card title="Outcome counts">
          <DataTable
            columns={frequencyColumns}
            rows={(output.frequencies ?? []).map((f) => ({ ...f, value: f.value }))}
            caption="How often the event occurred"
            emptyMessage="No outcomes recorded."
          />
          <p className="oc-chart-note">
            The event occurred in {Math.round(output.summary.mean * output.summary.n).toLocaleString('en-US')} of {output.summary.n.toLocaleString('en-US')} trials.
          </p>
        </Card>
      ) : output.frequencies && output.frequencies.length > 1 && output.frequencies.length <= 120 ? (
        <Card>
          <BarChart
            title={`Distribution of ${output.spec.label}`}
            description={`Bar chart of how often each value of ${output.spec.label} occurred across ${output.summary.n.toLocaleString('en-US')} simulated trials.`}
            data={output.frequencies.map((f) => ({ x: f.value, y: f.proportion }))}
            xLabel={`${output.spec.label}${unit}`}
            yLabel="Share of trials"
            seriesLabel="Observed share"
            asPercent
            onExport={exportFrequencies}
            note={`Based on ${output.summary.n.toLocaleString('en-US')} simulated trials. Shares are observed frequencies, which differ from the model's exact probabilities by sampling error.`}
          />
        </Card>
      ) : (
        <Card>
          <HistogramChart
            title={`Distribution of ${output.spec.label}`}
            description={`Histogram of ${output.summary.n.toLocaleString('en-US')} simulated values of ${output.spec.label}.`}
            bins={output.histogram}
            xLabel={`${output.spec.label}${unit}`}
            onExport={exportHistogram}
            markers={[
              { x: output.summary.mean, label: 'Mean' },
              { x: output.summary.median, label: 'Median' },
            ]}
            note="Bar height is density, so the total area is 1. Hover a bar for its exact count and share."
          />
        </Card>
      )}

      {!isIndicator && output.ecdf.length > 2 && (
        <Card>
          <LineChart
            title={`Cumulative distribution of ${output.spec.label}`}
            description={`Empirical cumulative distribution: for each value on the horizontal axis, the share of simulated outcomes at or below it.`}
            series={ecdfSeries}
            xLabel={`${output.spec.label}${unit}`}
            yLabel="Share of outcomes at or below"
            yDomain={[0, 1]}
            valueFormatter={(v) => formatPercent(v)}
            referenceLines={[
              { value: 0.5, label: 'Median', axis: 'y' },
              { value: 0.95, label: '95th percentile', axis: 'y' },
            ]}
            note="Read it in either direction: pick a value to see the share of outcomes below it, or pick a share to find the corresponding percentile."
            onExport={() => downloadText(`${output.spec.key}-ecdf.csv`, toCsv(['value', 'cumulative_share'], output.ecdf.map((p) => [p.x, p.p])))}
          />
        </Card>
      )}

      {output.convergence.length > 2 && (
        <Card>
          <ConvergenceChart
            title="How the estimate settled"
            description="The running estimate and its 95% confidence interval as trials accumulated."
            points={output.convergence}
            theoretical={
              output.theoretical && Number.isFinite(output.theoretical.probability ?? output.theoretical.mean ?? NaN)
                ? { value: (output.theoretical.probability ?? output.theoretical.mean) as number, label: 'Exact value' }
                : null
            }
            yLabel={isIndicator ? 'Estimated probability' : `Estimated average${unit}`}
            onExport={exportConvergence}
          />
          <p className="oc-chart-note">
            More trials narrow the interval, but they cannot correct a model that does not match reality. The interval shrinks roughly as 1/√n:
            {' '}
            {result.trialsCompleted.toLocaleString('en-US')} trials gave a half-width of about{' '}
            {formatValue((output.estimateInterval.high - output.estimateInterval.low) / 2, 3)}; reaching half that width would need about{' '}
            {(result.trialsCompleted * 4).toLocaleString('en-US')} trials.
          </p>
        </Card>
      )}

      {!isIndicator && (
        <Card title="Percentiles of the simulated outcomes" variant="inset">
          <DataTable
            columns={[
              { key: 'p', header: 'Percentile', numeric: true, render: (r) => `${((r as { p: number }).p * 100).toFixed(0)}%` },
              { key: 'v', header: `Value${unit}`, numeric: true, render: (r) => formatValue((r as { value: number }).value) },
            ]}
            rows={output.summary.quantiles}
            caption="Percentiles of the simulated outcomes"
          />
          <p className="oc-chart-note">
            Computed by linear interpolation between order statistics (the convention used by R, NumPy and Excel's PERCENTILE.INC). Extreme percentiles are the
            least reliable: they depend on the handful of most extreme trials.
          </p>
        </Card>
      )}

      {result.stoppedEarly && (
        <Notice tone="info" title="Stopped early">
          <p>The requested precision was reached before all trials were run, so the run ended at {result.trialsCompleted.toLocaleString('en-US')} trials.</p>
        </Notice>
      )}

      {output.spec.description && (
        <p className="oc-chart-note">
          <Badge>Output definition</Badge> {output.spec.description}
        </p>
      )}
    </div>
  );
}
