/**
 * Data lab: import a CSV or JSON file, inspect it, and analyse it locally.
 * The file is read in the browser with the File API; nothing is uploaded.
 */
import { useMemo, useRef, useState } from 'react';
import {
  DATA_LIMITS,
  cleanColumn,
  groupBy,
  pairedValues,
  parseCsv,
  parseJsonDataset,
  type Dataset,
  type MissingPolicy,
} from '../../engine/stats/dataset';
import { ecdfPoints, histogram, mean, pearson, sortedCopy, spearman, summarizeSample, tConfidenceInterval } from '../../engine/stats/descriptive';
import {
  chiSquareIndependence,
  correlationTest,
  kolmogorovSmirnovTest,
  mannWhitneyTest,
  oneSampleTTest,
  oneWayAnova,
  pairedTTest,
  welchTTest,
  type Alternative,
  type TestResult,
} from '../../engine/stats/tests';
import { normal } from '../../engine/distributions/continuous';
import { BOOTSTRAP_STATISTICS, type BootstrapStatistic } from '../../engine/stats/resampling-models';
import { Button, Card, DataTable, Notice, NumberField, SelectField, Segmented, useToast } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { HistogramChart, LineChart, ScatterChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { AssumptionsPanel } from '../shared/ExplanationPanel';
import { RunPanel, useSimulationRun } from '../shared/SimulationControls';
import { useApp } from '../store';
import { downloadText, toCsv } from '../../persistence/store';
import { Icon } from '../../ui/icons';

export interface DataLabConfig {
  /** The dataset is held in memory only; the config records how it was read. */
  fileName: string;
  tab: 'overview' | 'relationships' | 'tests' | 'bootstrap';
  columnName: string;
  secondColumnName: string;
  groupColumnName: string;
  missingPolicy: MissingPolicy;
  test: TestKind;
  alternative: Alternative;
  nullValue: number;
  bootstrapStatistic: BootstrapStatistic;
  bootstrapTrials: number;
  seed: string;
}

export type TestKind = 'one-sample-t' | 'welch-t' | 'paired-t' | 'correlation' | 'mann-whitney' | 'anova' | 'ks-normal' | 'chi-square';

export const DATA_LAB_DEFAULT: DataLabConfig = {
  fileName: '',
  tab: 'overview',
  columnName: '',
  secondColumnName: '',
  groupColumnName: '',
  missingPolicy: 'exclude',
  test: 'one-sample-t',
  alternative: 'two-sided',
  nullValue: 0,
  bootstrapStatistic: 'mean',
  bootstrapTrials: 20000,
  seed: 'bootstrap-1',
};

const TESTS: { value: TestKind; label: string; needs: string }[] = [
  { value: 'one-sample-t', label: 'One-sample t test (is the mean different from a value?)', needs: 'one numeric column' },
  { value: 'welch-t', label: "Welch's t test (do two groups have different means?)", needs: 'a numeric column and a grouping column with two groups' },
  { value: 'paired-t', label: 'Paired t test (matched observations)', needs: 'two numeric columns of equal length' },
  { value: 'correlation', label: 'Correlation test (is there a linear relationship?)', needs: 'two numeric columns' },
  { value: 'mann-whitney', label: 'Mann–Whitney U test (rank-based group comparison)', needs: 'a numeric column and a grouping column with two groups' },
  { value: 'anova', label: 'One-way ANOVA (do several groups differ?)', needs: 'a numeric column and a grouping column' },
  { value: 'ks-normal', label: 'Kolmogorov–Smirnov test against a normal distribution', needs: 'one numeric column' },
  { value: 'chi-square', label: 'Chi-square test of independence', needs: 'two categorical columns' },
];

export function DataLabTool({ config }: { config: DataLabConfig }) {
  const app = useApp();
  const toast = useToast();
  const set = (patch: Partial<DataLabConfig>) => app.updateConfig({ ...config, ...patch });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bootstrap = useSimulationRun();

  // Memoised so the analysis hooks below do not re-run on every render.
  const numericColumns = useMemo(() => dataset?.columns.filter((c) => c.type === 'numeric') ?? [], [dataset]);
  const categoricalColumns = useMemo(() => dataset?.columns.filter((c) => c.type === 'categorical') ?? [], [dataset]);
  const column = numericColumns.find((c) => c.name === config.columnName) ?? numericColumns[0];
  const second = numericColumns.find((c) => c.name === config.secondColumnName) ?? numericColumns[1];
  const groupColumn = dataset?.columns.find((c) => c.name === config.groupColumnName) ?? categoricalColumns[0];

  const cleaned = useMemo(() => {
    if (!column) return null;
    try {
      return cleanColumn(column, config.missingPolicy);
    } catch (e) {
      return { values: new Float64Array(0), removed: 0, note: (e as Error).message };
    }
  }, [column, config.missingPolicy]);

  const summary = useMemo(() => (cleaned && cleaned.values.length ? summarizeSample(cleaned.values) : null), [cleaned]);
  const sorted = useMemo(() => (cleaned && cleaned.values.length ? sortedCopy(cleaned.values) : null), [cleaned]);

  const onFile = async (file: File) => {
    setParseError(null);
    if (file.size > DATA_LIMITS.maxBytes) {
      setParseError(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB, larger than the ${(DATA_LIMITS.maxBytes / (1024 * 1024)).toFixed(0)} MB limit. Reduce the number of rows or split the file.`);
      return;
    }
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
      const ds = isJson ? parseJsonDataset(text, { name: file.name }) : parseCsv(text, { name: file.name });
      setDataset(ds);
      const firstNumeric = ds.columns.find((c) => c.type === 'numeric');
      const secondNumeric = ds.columns.filter((c) => c.type === 'numeric')[1];
      const firstCategorical = ds.columns.find((c) => c.type === 'categorical');
      set({
        fileName: file.name,
        columnName: firstNumeric?.name ?? '',
        secondColumnName: secondNumeric?.name ?? '',
        groupColumnName: firstCategorical?.name ?? '',
      });
      toast.push('success', `Loaded ${ds.rowCount.toLocaleString('en-US')} rows and ${ds.columns.length} columns from "${file.name}". The file stayed on your computer.`);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const testResult = useMemo<{ ok: true; value: TestResult } | { ok: false; error: string } | null>(() => {
    if (!dataset || config.tab !== 'tests') return null;
    try {
      switch (config.test) {
        case 'one-sample-t': {
          if (!cleaned?.values.length) return { ok: false, error: 'Choose a numeric column with values.' };
          return { ok: true, value: oneSampleTTest(cleaned.values, config.nullValue, config.alternative) };
        }
        case 'ks-normal': {
          if (!cleaned?.values.length || !summary) return { ok: false, error: 'Choose a numeric column with values.' };
          return {
            ok: true,
            value: kolmogorovSmirnovTest(cleaned.values, (x) => normal.cdf(x, { mu: summary.mean, sigma: summary.sd })),
          };
        }
        case 'paired-t':
        case 'correlation': {
          if (!column || !second) return { ok: false, error: 'Choose two numeric columns.' };
          const pv = pairedValues(column, second);
          if (pv.x.length < 3) return { ok: false, error: 'At least 3 complete pairs are needed.' };
          return { ok: true, value: config.test === 'paired-t' ? pairedTTest(pv.x, pv.y, config.alternative) : correlationTest(pv.x, pv.y, config.alternative) };
        }
        case 'welch-t':
        case 'mann-whitney': {
          if (!column || !groupColumn) return { ok: false, error: 'Choose a numeric column and a grouping column.' };
          const groups = groupBy(column, groupColumn);
          if (groups.length !== 2) return { ok: false, error: `"${groupColumn.name}" has ${groups.length} distinct value(s). This test needs exactly two groups.` };
          return { ok: true, value: config.test === 'welch-t' ? welchTTest(groups[0].values, groups[1].values, config.alternative) : mannWhitneyTest(groups[0].values, groups[1].values, config.alternative) };
        }
        case 'anova': {
          if (!column || !groupColumn) return { ok: false, error: 'Choose a numeric column and a grouping column.' };
          const groups = groupBy(column, groupColumn);
          if (groups.length < 2) return { ok: false, error: 'At least two groups are needed.' };
          return { ok: true, value: oneWayAnova(groups) };
        }
        case 'chi-square': {
          if (categoricalColumns.length < 2) return { ok: false, error: 'Two categorical columns are needed for a chi-square test of independence.' };
          const a = categoricalColumns.find((c) => c.name === config.groupColumnName) ?? categoricalColumns[0];
          const b = categoricalColumns.find((c) => c.name === config.secondColumnName) ?? categoricalColumns.find((c) => c.name !== a.name)!;
          const table = contingencyTable(a.raw, b.raw);
          return { ok: true, value: { ...chiSquareIndependence(table.counts), notes: [...chiSquareIndependence(table.counts).notes, `Rows: ${table.rowLabels.join(', ')}. Columns: ${table.colLabels.join(', ')}.`] } };
        }
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [dataset, config.tab, config.test, config.alternative, config.nullValue, cleaned, summary, column, second, groupColumn, categoricalColumns, config.groupColumnName, config.secondColumnName]);

  const relationship = useMemo(() => {
    if (!column || !second || config.tab !== 'relationships') return null;
    try {
      const pv = pairedValues(column, second);
      if (pv.x.length < 2) return null;
      const r = pearson(pv.x, pv.y);
      const rs = spearman(pv.x, pv.y);
      // Least-squares line for the scatter overlay.
      const mx = mean(pv.x);
      const my = mean(pv.y);
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < pv.x.length; i++) {
        sxy += (pv.x[i] - mx) * (pv.y[i] - my);
        sxx += (pv.x[i] - mx) ** 2;
      }
      const slope = sxx > 0 ? sxy / sxx : NaN;
      return { pv, r, rs, slope, intercept: my - slope * mx };
    } catch {
      return null;
    }
  }, [column, second, config.tab]);

  const correlationMatrix = useMemo(() => {
    if (!dataset || numericColumns.length < 2 || config.tab !== 'relationships') return null;
    const cols = numericColumns.slice(0, 10);
    return {
      labels: cols.map((c) => c.name),
      values: cols.map((a) =>
        cols.map((b) => {
          try {
            const pv = pairedValues(a, b);
            return pv.x.length >= 2 ? pearson(pv.x, pv.y) : NaN;
          } catch {
            return NaN;
          }
        }),
      ),
      truncated: numericColumns.length > 10,
    };
  }, [dataset, numericColumns, config.tab]);

  return (
    <>
      <ToolHeader toolId="data-lab" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Your data">
            <Notice tone="info" title="Your file stays on your computer">
              <p>
                The file is read in your browser and analysed here. It is never uploaded to a server — Orbis Chance has no server to upload to — and it is not
                written into the saved investigation.
              </p>
            </Notice>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.json" aria-label="Choose a CSV or JSON data file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
            <Button icon="upload" variant="primary" block onClick={() => fileRef.current?.click()}>
              {dataset ? 'Load a different file' : 'Choose a CSV or JSON file'}
            </Button>
            {dataset && (
              <p className="oc-field__hint">
                <strong>{dataset.name}</strong>: {dataset.rowCount.toLocaleString('en-US')} rows, {dataset.columns.length} columns, delimiter{' '}
                {dataset.delimiter === '\t' ? 'tab' : dataset.delimiter}.
              </p>
            )}
            {parseError && <Notice tone="error" title="This file could not be read">{parseError}</Notice>}
          </Card>

          {dataset && (
            <>
              <Card title="Columns">
                <SelectField
                  label="Main numeric column"
                  value={column?.name ?? ''}
                  onChange={(columnName) => set({ columnName })}
                  options={numericColumns.map((c) => ({ value: c.name, label: `${c.name} (${c.values.length - c.missing - c.invalid} values)` }))}
                  hint={numericColumns.length === 0 ? 'No numeric columns were found in this file.' : undefined}
                />
                {(config.tab === 'relationships' || ['paired-t', 'correlation', 'chi-square'].includes(config.test)) && (
                  <SelectField
                    label={config.test === 'chi-square' ? 'Second categorical column' : 'Second numeric column'}
                    value={second?.name ?? config.secondColumnName}
                    onChange={(secondColumnName) => set({ secondColumnName })}
                    options={(config.test === 'chi-square' ? categoricalColumns : numericColumns).map((c) => ({ value: c.name, label: c.name }))}
                  />
                )}
                {(['welch-t', 'mann-whitney', 'anova', 'chi-square'].includes(config.test) || config.tab === 'overview') && categoricalColumns.length > 0 && (
                  <SelectField
                    label="Grouping column"
                    value={groupColumn?.name ?? ''}
                    onChange={(groupColumnName) => set({ groupColumnName })}
                    options={dataset.columns.filter((c) => c.type !== 'empty').map((c) => ({ value: c.name, label: `${c.name} (${c.type})` }))}
                  />
                )}
                <SelectField
                  label="Missing values"
                  value={config.missingPolicy}
                  onChange={(missingPolicy) => set({ missingPolicy })}
                  options={[
                    { value: 'exclude', label: 'Leave them out' },
                    { value: 'mean', label: 'Replace with the mean' },
                    { value: 'zero', label: 'Replace with 0' },
                  ]}
                  hint={cleaned?.note}
                />
              </Card>

              <Card title="What to do">
                <Segmented
                  label="Analysis"
                  value={config.tab}
                  onChange={(tab) => set({ tab })}
                  options={[
                    { value: 'overview', label: 'Describe' },
                    { value: 'relationships', label: 'Relate' },
                    { value: 'tests', label: 'Test' },
                    { value: 'bootstrap', label: 'Bootstrap' },
                  ]}
                />
              </Card>

              {config.tab === 'tests' && (
                <Card title="Test settings">
                  <SelectField label="Test" value={config.test} onChange={(test) => set({ test })} options={TESTS.map((t) => ({ value: t.value, label: t.label }))} hint={`Needs ${TESTS.find((t) => t.value === config.test)?.needs}.`} />
                  {config.test === 'one-sample-t' && <NumberField label="Value to compare the mean against" value={config.nullValue} onChange={(nullValue) => set({ nullValue })} />}
                  {!['anova', 'chi-square', 'ks-normal'].includes(config.test) && (
                    <SelectField
                      label="Alternative hypothesis"
                      value={config.alternative}
                      onChange={(alternative) => set({ alternative })}
                      options={[
                        { value: 'two-sided', label: 'Different in either direction' },
                        { value: 'greater', label: 'Greater' },
                        { value: 'less', label: 'Less' },
                      ]}
                      hint="Choose this before looking at the data. Picking the direction after seeing the result invalidates the p-value."
                    />
                  )}
                </Card>
              )}

              {config.tab === 'bootstrap' && (
                <Card title="Bootstrap settings">
                  <SelectField label="Statistic" value={config.bootstrapStatistic} onChange={(bootstrapStatistic) => set({ bootstrapStatistic })} options={BOOTSTRAP_STATISTICS.map((s) => ({ value: s.id, label: s.label }))} />
                  <NumberField label="Resamples" value={config.bootstrapTrials} onChange={(bootstrapTrials) => set({ bootstrapTrials })} min={200} max={200000} integer />
                  <RunPanel
                    state={bootstrap.state}
                    onRun={() => {
                      if (!cleaned?.values.length) return;
                      bootstrap.run({ modelId: 'bootstrap', config: { data: Array.from(cleaned.values), statistic: config.bootstrapStatistic }, trials: config.bootstrapTrials, seed: config.seed });
                    }}
                    onCancel={bootstrap.cancel}
                    runLabel="Run the bootstrap"
                    unitLabel="resamples"
                    disabled={!cleaned?.values.length}
                    fallbackReason={bootstrap.fallbackReason}
                  />
                </Card>
              )}
            </>
          )}

          <AiAssistPanel capability="interpretStatistics" context="Every test result below states its hypotheses, its effect size and the standard misinterpretations to avoid." />
        </div>

        <div className="oc-stack">
          {!dataset && (
            <Card>
              <div className="oc-empty">
                <span className="oc-empty__icon" aria-hidden="true">
                  <Icon name="data" size={44} />
                </span>
                <h3>No data loaded</h3>
                <p>
                  Choose a CSV or JSON file to begin. A CSV should have a header row; a JSON file should be an array of objects with the same fields, or an
                  object whose values are arrays. Up to {DATA_LIMITS.maxRows.toLocaleString('en-US')} rows and{' '}
                  {(DATA_LIMITS.maxBytes / (1024 * 1024)).toFixed(0)} MB are supported.
                </p>
              </div>
            </Card>
          )}

          {dataset && (
            <>
              {dataset.notes.length > 0 && <Notice tone="warning" title="What happened when the file was read" items={dataset.notes} />}

              <Card title="Data preview" hint={`First ${Math.min(DATA_LIMITS.previewRows, dataset.rowCount)} of ${dataset.rowCount.toLocaleString('en-US')} rows.`}>
                <DataTable
                  caption="Data preview"
                  maxHeight={300}
                  columns={dataset.columns.map((c, ci) => ({
                    key: c.name,
                    header: c.name,
                    numeric: c.type === 'numeric',
                    title: `${c.type}${c.missing + c.invalid > 0 ? `, ${c.missing + c.invalid} missing or unreadable` : ''}`,
                    render: (r: unknown) => {
                      const raw = (r as { cells: string[] }).cells[ci];
                      if (!raw.trim()) return <span className="oc-muted">—</span>;
                      if (c.type === 'numeric' && !Number.isFinite(c.values[(r as { index: number }).index])) {
                        return <span style={{ color: 'var(--status-warning)' }} title="Could not be read as a number">{raw}</span>;
                      }
                      return raw;
                    },
                  }))}
                  rows={Array.from({ length: Math.min(DATA_LIMITS.previewRows, dataset.rowCount) }, (_, i) => ({ index: i, cells: dataset.columns.map((c) => c.raw[i] ?? '') }))}
                />
                <DataTable
                  caption="Column summary"
                  columns={[
                    { key: 'n', header: 'Column', render: (r) => (r as ColInfo).name },
                    { key: 't', header: 'Type', render: (r) => (r as ColInfo).type },
                    { key: 'v', header: 'Values', numeric: true, render: (r) => (r as ColInfo).count.toLocaleString('en-US') },
                    { key: 'm', header: 'Missing', numeric: true, render: (r) => (r as ColInfo).missing.toLocaleString('en-US') },
                    { key: 'i', header: 'Unreadable', numeric: true, render: (r) => (r as ColInfo).invalid.toLocaleString('en-US') },
                    { key: 'd', header: 'Distinct', numeric: true, render: (r) => ((r as ColInfo).distinct === null ? 'many' : (r as ColInfo).distinct!.toLocaleString('en-US')) },
                  ]}
                  rows={dataset.columns.map((c) => ({
                    name: c.name,
                    type: c.type,
                    count: c.raw.length - c.missing - c.invalid,
                    missing: c.missing,
                    invalid: c.invalid,
                    distinct: c.categories?.length ?? null,
                  }))}
                />
              </Card>

              {config.tab === 'overview' && summary && sorted && column && (
                <>
                  <Card title={`Describing "${column.name}"`}>
                    <div className="oc-figure-grid">
                      <Fig label="Observations used" value={summary.n.toLocaleString('en-US')} sub={cleaned && cleaned.removed > 0 ? `${cleaned.removed} excluded` : undefined} />
                      <Fig label="Mean" value={formatValue(summary.mean)} />
                      <Fig label="Median" value={formatValue(summary.median)} />
                      <Fig label="Standard deviation" value={formatValue(summary.sd)} sub="Sample, with n − 1 in the denominator" />
                      <Fig label="Minimum" value={formatValue(summary.min)} />
                      <Fig label="Maximum" value={formatValue(summary.max)} />
                      <Fig label="Interquartile range" value={formatValue(summary.iqr)} sub={`${formatValue(summary.q1, 4)} to ${formatValue(summary.q3, 4)}`} />
                      <Fig label="Skewness" value={Number.isNaN(summary.skewness) ? 'undefined' : formatValue(summary.skewness, 4)} sub={skewHint(summary.skewness)} />
                      <Fig label="Excess kurtosis" value={Number.isNaN(summary.excessKurtosis) ? 'undefined' : formatValue(summary.excessKurtosis, 4)} sub={kurtHint(summary.excessKurtosis)} />
                      <Fig label="Standard error of the mean" value={formatValue(summary.standardError, 4)} />
                    </div>
                    {(() => {
                      const ci = tConfidenceInterval(summary.mean, summary.sd, summary.n);
                      return Number.isFinite(ci.low) ? (
                        <p className="oc-chart-note">
                          95% confidence interval for the mean: {formatValue(ci.low, 6)} to {formatValue(ci.high, 6)} ({ci.method}). This describes how precisely
                          the mean of the underlying population is pinned down by these {summary.n.toLocaleString('en-US')} observations — not the range of
                          individual values, which runs from {formatValue(summary.min, 4)} to {formatValue(summary.max, 4)}.
                        </p>
                      ) : null;
                    })()}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="download"
                      onClick={() =>
                        downloadText(
                          `${column.name}-summary.csv`,
                          toCsv(
                            ['statistic', 'value'],
                            [
                              ['n', summary.n],
                              ['mean', summary.mean],
                              ['median', summary.median],
                              ['sd', summary.sd],
                              ['min', summary.min],
                              ['max', summary.max],
                              ['q1', summary.q1],
                              ['q3', summary.q3],
                              ['skewness', summary.skewness],
                              ['excess_kurtosis', summary.excessKurtosis],
                              ...summary.quantiles.map((q) => [`p${q.p * 100}`, q.value]),
                            ],
                          ),
                        )
                      }
                    >
                      Export summary as CSV
                    </Button>
                  </Card>

                  <Card>
                    <HistogramChart
                      title={`Distribution of ${column.name}`}
                      description={`Histogram of ${summary.n.toLocaleString('en-US')} values of ${column.name}.`}
                      bins={histogram(sorted)}
                      xLabel={column.name}
                      markers={[{ x: summary.mean, label: 'Mean' }, { x: summary.median, label: 'Median' }]}
                      overlay={{ label: 'Normal distribution with the same mean and SD', points: normalOverlay(sorted, summary.mean, summary.sd) }}
                      note="Bin widths come from the Freedman–Diaconis rule. The overlaid curve is the normal distribution with the same mean and standard deviation, for comparison only — it is not a claim that the data are normal."
                    />
                  </Card>

                  <Card>
                    <LineChart
                      title={`Cumulative distribution of ${column.name}`}
                      description="Empirical cumulative distribution of the selected column."
                      series={[{ label: 'Share of observations at or below', points: ecdfPoints(sorted).map((p) => ({ x: p.x, y: p.p })) }]}
                      xLabel={column.name}
                      yLabel="Share at or below"
                      yDomain={[0, 1]}
                      valueFormatter={(v) => formatPercent(v)}
                    />
                  </Card>

                  {groupColumn && groupColumn.type === 'categorical' && (
                    <GroupComparison column={column} groupColumn={groupColumn} />
                  )}

                  <Card title="Percentiles">
                    <DataTable
                      caption="Percentiles"
                      columns={[
                        { key: 'p', header: 'Percentile', numeric: true, render: (r) => `${((r as Q).p * 100).toFixed(0)}%` },
                        { key: 'v', header: 'Value', numeric: true, render: (r) => formatValue((r as Q).value, 6) },
                      ]}
                      rows={summary.quantiles as Q[]}
                    />
                    <p className="oc-chart-note">Linear interpolation between order statistics, the convention used by R, NumPy and Excel's PERCENTILE.INC.</p>
                  </Card>
                </>
              )}

              {config.tab === 'relationships' && (
                <>
                  {!second && <Notice tone="info" title="Two numeric columns are needed">Choose a second numeric column to examine a relationship.</Notice>}
                  {relationship && column && second && (
                    <>
                      <Card title={`${column.name} and ${second.name}`}>
                        <div className="oc-figure-grid">
                          <Fig label="Complete pairs" value={relationship.pv.x.length.toLocaleString('en-US')} sub={relationship.pv.dropped > 0 ? `${relationship.pv.dropped} row(s) dropped for missing values` : undefined} />
                          <Fig label="Pearson correlation" value={Number.isNaN(relationship.r) ? 'undefined' : formatValue(relationship.r, 4)} sub="Linear association" />
                          <Fig label="Spearman correlation" value={Number.isNaN(relationship.rs) ? 'undefined' : formatValue(relationship.rs, 4)} sub="Monotonic association, resistant to outliers" />
                          <Fig label="r²" value={Number.isNaN(relationship.r) ? '—' : formatPercent(relationship.r ** 2, 4)} sub="Share of variance matched by a straight line" />
                        </div>
                        <Notice tone="warning" title="Correlation is not causation">
                          <p>
                            A correlation of {Number.isNaN(relationship.r) ? '—' : formatValue(relationship.r, 3)} says these two columns move together in this
                            dataset. It does not show that one causes the other: a third factor may drive both, the direction may be the reverse of what seems
                            natural, or the pattern may be a coincidence of this particular sample.
                          </p>
                          {Math.abs(relationship.rs - relationship.r) > 0.15 && (
                            <p>
                              The Pearson and Spearman values differ noticeably, which suggests the relationship is curved or that a few extreme points are
                              pulling the linear correlation.
                            </p>
                          )}
                        </Notice>
                      </Card>

                      <Card>
                        <ScatterChart
                          title={`${second.name} against ${column.name}`}
                          description={`Scatter plot of ${relationship.pv.x.length} paired observations with a least-squares line.`}
                          points={Array.from({ length: relationship.pv.x.length }, (_, i) => ({ x: relationship.pv.x[i], y: relationship.pv.y[i] }))}
                          xLabel={column.name}
                          yLabel={second.name}
                          trendLine={Number.isFinite(relationship.slope) ? { slope: relationship.slope, intercept: relationship.intercept, label: 'Least-squares line' } : null}
                          note={Number.isFinite(relationship.slope) ? `Least-squares line: ${second.name} ≈ ${formatValue(relationship.intercept, 4)} + ${formatValue(relationship.slope, 4)} × ${column.name}. The line describes the pattern; it does not establish that changing one variable would change the other.` : undefined}
                          onExport={() => downloadText('pairs.csv', toCsv([column.name, second.name], Array.from({ length: relationship.pv.x.length }, (_, i) => [relationship.pv.x[i], relationship.pv.y[i]])))}
                        />
                      </Card>
                    </>
                  )}

                  {correlationMatrix && (
                    <Card title="Correlation matrix" hint="Pearson correlation between every pair of numeric columns.">
                      <DataTable
                        caption="Correlation matrix"
                        columns={[
                          { key: 'row', header: '', render: (r) => <strong>{(r as MatrixRow).label}</strong> },
                          ...correlationMatrix.labels.map((l, ci) => ({
                            key: l,
                            header: l,
                            numeric: true,
                            render: (r: unknown) => {
                              const v = (r as MatrixRow).values[ci];
                              if (Number.isNaN(v)) return '—';
                              const strong = Math.abs(v) > 0.7;
                              return <span style={strong ? { fontWeight: 600 } : undefined}>{formatValue(v, 3)}</span>;
                            },
                          })),
                        ]}
                        rows={correlationMatrix.labels.map((label, ri) => ({ label, values: correlationMatrix.values[ri] }))}
                      />
                      <p className="oc-chart-note">
                        {correlationMatrix.truncated ? `Only the first 10 numeric columns are shown. ` : ''}
                        Values near ±1 mean a strong linear relationship in this dataset. With {correlationMatrix.labels.length} columns there are{' '}
                        {(correlationMatrix.labels.length * (correlationMatrix.labels.length - 1)) / 2} pairs, so some will look notable by chance alone —
                        treat an unexpected strong correlation as something to investigate, not a finding.
                      </p>
                    </Card>
                  )}
                </>
              )}

              {config.tab === 'tests' && testResult && (
                <>
                  {!testResult.ok && <Notice tone="error" title="This test cannot be run on the selected columns">{testResult.error}</Notice>}
                  {testResult.ok && <TestResultCard result={testResult.value} />}
                </>
              )}

              {config.tab === 'bootstrap' && (
                <>
                  {!cleaned?.values.length && <Notice tone="info">Choose a numeric column with values to bootstrap.</Notice>}
                  {bootstrap.state.result && (() => {
                    const out = bootstrap.state.result.outputs[0];
                    const q = (p: number) => out.summary.quantiles.find((x) => x.p === p)?.value ?? NaN;
                    const observed = out.theoretical?.mean ?? NaN;
                    return (
                      <>
                        <Card title="Bootstrap interval">
                          <div className="oc-result-hero">
                            <span className="oc-result-hero__label">Observed {BOOTSTRAP_STATISTICS.find((s) => s.id === config.bootstrapStatistic)?.label.toLowerCase()} in your data</span>
                            <span className="oc-result-hero__value">{formatValue(observed, 6)}</span>
                            <span className="oc-result-hero__detail">
                              95% percentile bootstrap interval: {formatValue(q(0.025) || q(0.05), 6)} to {formatValue(q(0.975) || q(0.95), 6)}
                            </span>
                          </div>
                          <div className="oc-figure-grid">
                            <Fig label="Bootstrap standard error" value={formatValue(out.summary.sd, 5)} sub="The spread of the statistic across resamples" />
                            <Fig label="Bootstrap mean" value={formatValue(out.summary.mean, 6)} />
                            <Fig label="Estimated bias" value={formatValue(out.summary.mean - observed, 4)} sub="Bootstrap mean minus the observed value" />
                            <Fig label="Resamples" value={out.summary.n.toLocaleString('en-US')} />
                          </div>
                          <Notice tone="info" title="What a bootstrap interval is">
                            <p>
                              Resampling your data with replacement imitates drawing fresh samples from the population. The spread of the statistic across
                              those resamples estimates how much it would vary across real samples. It cannot correct a sample that is not representative of the
                              population to begin with.
                            </p>
                          </Notice>
                        </Card>
                        <Card>
                          <HistogramChart
                            title="Bootstrap distribution of the statistic"
                            description="Histogram of the statistic computed on each bootstrap resample."
                            bins={out.histogram}
                            xLabel={BOOTSTRAP_STATISTICS.find((s) => s.id === config.bootstrapStatistic)?.label ?? 'Statistic'}
                            markers={[{ x: observed, label: 'Observed' }]}
                            note="The observed value marked here is the statistic in your actual data. A bootstrap distribution centred away from it indicates bias in the statistic."
                          />
                        </Card>
                        <AssumptionsPanel assumptions={bootstrap.state.result.assumptions} limitations={['A percentile bootstrap interval can be inaccurate for statistics with strong bias or skew; for those, a bias-corrected method is preferable.', 'The interval reflects sampling variability only. It does not account for measurement error, selection bias, or a population that differs from the one sampled.']} title="Bootstrap assumptions and limitations" />
                      </>
                    );
                  })()}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface ColInfo {
  name: string;
  type: string;
  count: number;
  missing: number;
  invalid: number;
  distinct: number | null;
}
interface Q {
  p: number;
  value: number;
}
interface MatrixRow {
  label: string;
  values: number[];
}

function TestResultCard({ result }: { result: TestResult }) {
  const significant = result.pValue < 0.05;
  return (
    <>
      <Card title={result.name}>
        <div className="oc-result-hero">
          <span className="oc-result-hero__label">p-value</span>
          <span className="oc-result-hero__value">{result.pValue < 1e-4 ? result.pValue.toExponential(2) : formatValue(result.pValue, 4)}</span>
          <span className="oc-result-hero__detail">
            {result.statisticName} = {formatValue(result.statistic, 5)}
            {result.degreesOfFreedom !== null && ` · degrees of freedom ${Array.isArray(result.degreesOfFreedom) ? result.degreesOfFreedom.join(', ') : formatValue(result.degreesOfFreedom, 5)}`}
          </span>
          <span className="oc-result-hero__detail oc-muted">
            {/* A text statement, so significance is not conveyed by colour alone. */}
            {significant
              ? `Below the conventional 0.05 threshold: a result this extreme would be uncommon if the null hypothesis were true.`
              : `Above the conventional 0.05 threshold: this data does not distinguish the null hypothesis from the alternative.`}
          </span>
        </div>

        <DataTable
          caption="Hypotheses and effect size"
          columns={[
            { key: 'k', header: '', render: (r) => (r as KV).k },
            { key: 'v', header: '', render: (r) => (r as KV).v },
          ]}
          rows={[
            { k: 'Null hypothesis', v: result.nullHypothesis },
            { k: 'Alternative', v: result.alternativeHypothesis },
            ...(result.effectSize ? [{ k: result.effectSize.name, v: `${formatValue(result.effectSize.value, 5)} — ${result.effectSize.interpretation}` }] : []),
            ...(result.interval ? [{ k: `${(result.interval.level * 100).toFixed(0)}% interval for ${result.interval.of}`, v: `${formatValue(result.interval.low, 5)} to ${formatValue(result.interval.high, 5)}` }] : []),
          ] as KV[]}
        />

        {result.notes.length > 0 && <Notice tone="info" title="About this test" items={result.notes} />}

        <Notice tone="warning" title="Read the effect size, not just the p-value">
          <p>
            A p-value answers one narrow question: how surprising this data would be if the null hypothesis were true. It does not say how large the difference
            is, whether it matters, or how likely the null hypothesis is. The effect size and the interval above are what tell you about magnitude.
          </p>
        </Notice>
      </Card>
      <AssumptionsPanel assumptions={result.assumptions} limitations={result.limitations} title="Test assumptions and limitations" />
    </>
  );
}

interface KV {
  k: string;
  v: string;
}

function GroupComparison({ column, groupColumn }: { column: Parameters<typeof groupBy>[0]; groupColumn: Parameters<typeof groupBy>[1] }) {
  const groups = useMemo(() => {
    try {
      return groupBy(column, groupColumn).slice(0, 12);
    } catch {
      return [];
    }
  }, [column, groupColumn]);
  if (groups.length < 2) return null;
  return (
    <Card title={`${column.name} by ${groupColumn.name}`}>
      <DataTable
        caption="Group comparison"
        columns={[
          { key: 'g', header: groupColumn.name, render: (r) => (r as GroupRow).label },
          { key: 'n', header: 'n', numeric: true, render: (r) => (r as GroupRow).n.toLocaleString('en-US') },
          { key: 'm', header: 'Mean', numeric: true, render: (r) => formatValue((r as GroupRow).mean, 5) },
          { key: 'sd', header: 'SD', numeric: true, render: (r) => formatValue((r as GroupRow).sd, 5) },
          { key: 'md', header: 'Median', numeric: true, render: (r) => formatValue((r as GroupRow).median, 5) },
          { key: 'r', header: 'Range', render: (r) => `${formatValue((r as GroupRow).min, 4)} – ${formatValue((r as GroupRow).max, 4)}` },
        ]}
        rows={groups.map((g) => {
          const s = summarizeSample(g.values);
          return { label: g.label, n: s.n, mean: s.mean, sd: s.sd, median: s.median, min: s.min, max: s.max };
        })}
      />
      <p className="oc-chart-note">
        Groups with few observations have imprecise means. To test whether the difference between groups is more than sampling variation, use the Test tab —
        but note that comparing many groups raises the chance that one difference looks notable by accident.
      </p>
    </Card>
  );
}

interface GroupRow {
  label: string;
  n: number;
  mean: number;
  sd: number;
  median: number;
  min: number;
  max: number;
}

function normalOverlay(sorted: Float64Array, mu: number, sigma: number): { x: number; y: number }[] {
  if (!(sigma > 0) || sorted.length === 0) return [];
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 160; i++) {
    const x = lo + ((hi - lo) * i) / 159;
    out.push({ x, y: normal.pdf(x, { mu, sigma }) });
  }
  return out;
}

function contingencyTable(a: string[], b: string[]): { counts: number[][]; rowLabels: string[]; colLabels: string[] } {
  const rowLabels = [...new Set(a.map((v) => v.trim() || '(missing)'))].sort();
  const colLabels = [...new Set(b.map((v) => v.trim() || '(missing)'))].sort();
  const counts = rowLabels.map(() => colLabels.map(() => 0));
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ri = rowLabels.indexOf(a[i].trim() || '(missing)');
    const ci = colLabels.indexOf(b[i].trim() || '(missing)');
    if (ri >= 0 && ci >= 0) counts[ri][ci]++;
  }
  return { counts, rowLabels, colLabels };
}

function skewHint(s: number): string | undefined {
  if (Number.isNaN(s)) return undefined;
  if (Math.abs(s) < 0.5) return 'Roughly symmetric';
  return s > 0 ? 'Long right tail' : 'Long left tail';
}

function kurtHint(k: number): string | undefined {
  if (Number.isNaN(k)) return undefined;
  if (Math.abs(k) < 0.5) return 'Tails like a normal distribution';
  return k > 0 ? 'Heavier tails and more outliers than normal' : 'Lighter tails than normal';
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
