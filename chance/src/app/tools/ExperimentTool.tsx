/**
 * Experiment laboratory: coins, dice, cards, urns and custom outcome sets,
 * with observed frequencies compared against the exact theoretical
 * distribution.
 */
import { useMemo, useState } from 'react';
import {
  CARD_RANKS,
  CARD_SUITS,
  exactSuccessDistribution,
  exactTotalDistribution,
  normaliseSource,
  validateExperiment,
  type ExperimentConfig as EngineExperimentConfig,
  type ExperimentSourceKind,
} from '../../engine/experiments/model';
import { randomSeed } from '../../engine/random/rng';
import { Badge, Button, Card, Checkbox, DataTable, Notice, NumberField, RawNumberInput, SelectField, SliderField, TextField } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { BarChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { RunPanel, SimulationSettingsCard, useSimulationRun } from '../shared/SimulationControls';
import { SimulationResults } from '../shared/SimulationResults';
import { useApp } from '../store';
import { downloadText, toCsv } from '../../persistence/store';

export interface ExperimentToolConfig extends EngineExperimentConfig {
  trials: number;
  seed: string;
}

export const EXPERIMENT_DEFAULT: ExperimentToolConfig = {
  source: { kind: 'coin', count: 10, headsProbability: 0.5 },
  successCondition: '',
  trackFirstDraw: false,
  trials: 20000,
  seed: 'coin-demo',
};

const SOURCES: { value: ExperimentSourceKind; label: string }[] = [
  { value: 'coin', label: 'Coins' },
  { value: 'dice', label: 'Dice' },
  { value: 'deck', label: 'Playing cards' },
  { value: 'urn', label: 'A collection of objects' },
  { value: 'custom', label: 'Custom outcomes' },
];

export function ExperimentTool({ config }: { config: ExperimentToolConfig }) {
  const app = useApp();
  const set = (patch: Partial<ExperimentToolConfig>) => app.updateConfig({ ...config, ...patch });
  const run = useSimulationRun();
  const [compareRuns, setCompareRuns] = useState<{ seed: string; successes: number; trials: number }[]>([]);

  const issues = useMemo(() => validateExperiment(config), [config]);

  const described = useMemo(() => {
    if (issues.length) return null;
    try {
      return normaliseSource(config.source);
    } catch {
      return null;
    }
  }, [config.source, issues]);

  const exact = useMemo(() => {
    if (issues.length) return null;
    return { successes: exactSuccessDistribution(config), total: exactTotalDistribution(config) };
  }, [config, issues]);

  const doRun = () => {
    run.run({ modelId: 'experiment', config: { source: config.source, successCondition: config.successCondition, trackFirstDraw: config.trackFirstDraw }, trials: config.trials, seed: config.seed });
  };

  // Comparison of observed frequencies against the exact distribution.
  const comparison = useMemo(() => {
    const result = run.state.result;
    if (!result) return null;
    const successOut = result.outputs.find((o) => o.spec.key === 'successes');
    const totalOut = result.outputs.find((o) => o.spec.key === 'total');
    const build = (out: typeof successOut, table: { rows: { value: number; probability: number }[] } | null) => {
      if (!out?.frequencies || !table) return null;
      const byValue = new Map(table.rows.map((r) => [r.value, r.probability]));
      const values = new Set<number>([...out.frequencies.map((f) => f.value), ...table.rows.map((r) => r.value)]);
      return [...values]
        .sort((a, b) => a - b)
        .map((v) => ({
          x: v,
          y: out.frequencies!.find((f) => f.value === v)?.proportion ?? 0,
          compare: byValue.get(v) ?? 0,
        }));
    };
    return {
      successes: build(successOut, exact?.successes ?? null),
      total: build(totalOut, exact?.total ?? null),
    };
  }, [run.state.result, exact]);

  return (
    <>
      <ToolHeader toolId="experiment" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="The experiment">
            <SelectField
              label="What is being used"
              value={config.source.kind}
              onChange={(kind) => set({ source: defaultSource(kind) })}
              options={SOURCES}
            />
            <SourceEditor config={config} set={set} />
          </Card>

          <Card title="Success condition" hint="Optional. Counts a repetition as a success when the condition holds.">
            <TextField
              label="Condition"
              value={config.successCondition ?? ''}
              onChange={(successCondition) => set({ successCondition })}
              placeholder="total >= 11"
              monospace
              hint="Available values: total, successes, draws, distinct, maxRun. Example: successes >= 2 and total < 20."
              error={issues.find((i) => i.field === 'successCondition')?.message}
            />
          </Card>

          <SimulationSettingsCard
            settings={{ trials: config.trials, seed: config.seed, keepSamples: false }}
            onChange={(s) => set({ trials: s.trials, seed: s.seed })}
            trialLabel="repetitions"
            maxTrials={500000}
          />

          <RunPanel state={run.state} onRun={doRun} onCancel={run.cancel} runLabel="Run the experiment" unitLabel="repetitions" disabled={issues.length > 0} fallbackReason={run.fallbackReason} />

          {run.state.result && (
            <Card title="Compare runs" hint="Run again with a new seed to see how much the observed frequencies move.">
              <div className="oc-btn-row">
                <Button
                  icon="shuffle"
                  onClick={() => {
                    const result = run.state.result!;
                    const s = result.outputs.find((o) => o.spec.key === 'successes');
                    if (s) setCompareRuns((prev) => [...prev.slice(-4), { seed: result.seed, successes: s.summary.mean, trials: result.trialsCompleted }]);
                    const seed = randomSeed();
                    set({ seed });
                    run.run({ modelId: 'experiment', config: { source: config.source, successCondition: config.successCondition, trackFirstDraw: config.trackFirstDraw }, trials: config.trials, seed });
                  }}
                >
                  New seed and run again
                </Button>
                {compareRuns.length > 0 && (
                  <Button icon="reset" variant="ghost" onClick={() => setCompareRuns([])}>
                    Clear history
                  </Button>
                )}
              </div>
              {compareRuns.length > 0 && (
                <DataTable
                  caption="Previous runs"
                  columns={[
                    { key: 's', header: 'Seed', render: (r) => <code>{(r as RunRow).seed}</code> },
                    { key: 'n', header: 'Repetitions', numeric: true, render: (r) => (r as RunRow).trials.toLocaleString('en-US') },
                    { key: 'm', header: 'Mean successes', numeric: true, render: (r) => formatValue((r as RunRow).successes, 5) },
                  ]}
                  rows={compareRuns as RunRow[]}
                />
              )}
            </Card>
          )}

          <AiAssistPanel capability="suggestFollowUps" context="Change the number of repetitions, bias a face, or switch replacement on and off to see how each affects the outcome." />
        </div>

        <div className="oc-stack">
          {issues.length > 0 && <Notice tone="error" title="This experiment cannot be run as configured" items={issues.map((i) => i.message)} />}

          {described && (
            <Card title="What will happen" variant="inset">
              <p style={{ fontSize: 12.5, marginBottom: 'var(--s2)' }}>
                Each repetition: {described.describe}.
              </p>
              <p style={{ fontSize: 12.5, margin: 0 }} className="oc-muted">
                {described.withReplacement
                  ? 'Draws are independent: the composition does not change between draws.'
                  : 'Draws are dependent: each object removed changes the probabilities for the next draw. The theoretical values below account for this.'}
              </p>
            </Card>
          )}

          {exact?.successes && (
            <Card title="Exact theoretical distribution" actions={<Badge variant="exact">Exact</Badge>}>
              <BarChart
                title="Number of successes: exact probabilities"
                description="The exact probability of each possible number of successes, computed from the model rather than simulated."
                data={exact.successes.rows.map((r) => ({ x: r.value, y: r.probability }))}
                xLabel="Number of successes"
                yLabel="Probability"
                seriesLabel="Exact probability"
                asPercent
                note={exact.successes.method}
                onExport={() => downloadText('exact-successes.csv', toCsv(['successes', 'probability'], exact.successes!.rows.map((r) => [r.value, r.probability])))}
              />
            </Card>
          )}

          {run.state.status === 'idle' && !run.state.result && (
            <Card>
              <Notice tone="info" title="Nothing has been simulated yet">
                <p>
                  The chart above shows the exact mathematics. Run the experiment to see how observed frequencies from a finite number of repetitions compare
                  with it — they will be close, but not identical, and the difference shrinks as repetitions increase.
                </p>
              </Notice>
            </Card>
          )}

          {comparison?.successes && (
            <Card title="Observed against theoretical">
              <BarChart
                title="Number of successes: observed and exact"
                description="Observed frequencies from the simulation compared with the exact theoretical probabilities."
                data={comparison.successes}
                xLabel="Number of successes"
                yLabel="Share"
                seriesLabel="Observed frequency"
                compareLabel="Exact probability"
                asPercent
                note="The rule across each bar is the exact probability. Differences are sampling error, not a flaw in either number — and they shrink as the number of repetitions grows."
                onExport={() => downloadText('observed-vs-exact.csv', toCsv(['successes', 'observed', 'exact'], comparison.successes!.map((d) => [d.x, d.y, d.compare ?? 0])))}
              />
              <DataTable
                caption="Observed and exact probabilities with differences"
                maxHeight={280}
                columns={[
                  { key: 'v', header: 'Successes', numeric: true, render: (r) => String((r as Cmp).x) },
                  { key: 'o', header: 'Observed', numeric: true, render: (r) => formatPercent((r as Cmp).y, 4) },
                  { key: 'e', header: 'Exact', numeric: true, render: (r) => formatPercent((r as Cmp).compare ?? 0, 4) },
                  {
                    key: 'd',
                    header: 'Difference',
                    numeric: true,
                    render: (r) => {
                      const d = (r as Cmp).y - ((r as Cmp).compare ?? 0);
                      return `${d >= 0 ? '+' : '−'}${formatPercent(Math.abs(d), 3)}`;
                    },
                  },
                ]}
                rows={comparison.successes as Cmp[]}
              />
            </Card>
          )}

          {comparison?.total && comparison.total.length > 1 && comparison.total.length <= 120 && (
            <Card>
              <BarChart
                title="Total of drawn values: observed and exact"
                description="Observed distribution of the per-repetition total compared with the exact convolution."
                data={comparison.total}
                xLabel="Total"
                yLabel="Share"
                seriesLabel="Observed frequency"
                compareLabel="Exact probability"
                asPercent
                note={exact?.total?.method}
              />
            </Card>
          )}

          {run.state.result && <SimulationResults result={run.state.result} title="Full results" />}
        </div>
      </div>
    </>
  );
}

interface Cmp {
  x: number;
  y: number;
  compare?: number;
}
interface RunRow {
  seed: string;
  successes: number;
  trials: number;
}

function defaultSource(kind: ExperimentSourceKind): EngineExperimentConfig['source'] {
  switch (kind) {
    case 'coin':
      return { kind: 'coin', count: 10, headsProbability: 0.5 };
    case 'dice':
      return { kind: 'dice', count: 2, faces: 6 };
    case 'deck':
      return { kind: 'deck', decks: 1, draws: 5, withReplacement: false, successRanks: ['A'], successSuits: [] };
    case 'urn':
      return {
        kind: 'urn',
        items: [
          { label: 'Red', count: 5, value: 1, success: true },
          { label: 'Blue', count: 7, value: 0, success: false },
        ],
        draws: 3,
        withReplacement: false,
      };
    case 'custom':
      return {
        kind: 'custom',
        faces: [
          { label: 'Win', value: 1, weight: 1 },
          { label: 'Draw', value: 0, weight: 2 },
          { label: 'Lose', value: -1, weight: 3 },
        ],
        draws: 1,
        withReplacement: true,
      };
  }
}

function SourceEditor({ config, set }: { config: ExperimentToolConfig; set(patch: Partial<ExperimentToolConfig>): void }) {
  const source = config.source;
  const update = (patch: Record<string, unknown>) => set({ source: { ...source, ...patch } as EngineExperimentConfig['source'] });

  if (source.kind === 'coin') {
    return (
      <>
        <NumberField label="Number of coins per repetition" value={source.count} onChange={(count) => update({ count })} min={1} max={10000} integer />
        <SliderField label="Probability of heads" symbol="p" value={source.headsProbability} onChange={(headsProbability) => update({ headsProbability })} min={0} max={1} step={0.01} hint="0.5 is a fair coin. Anything else is a biased coin." />
      </>
    );
  }

  if (source.kind === 'dice') {
    const weights = source.weights;
    return (
      <>
        <NumberField label="Number of dice per repetition" value={source.count} onChange={(count) => update({ count })} min={1} max={1000} integer />
        <NumberField label="Faces per die" value={source.faces} onChange={(faces) => update({ faces, weights: weights ? new Array(faces).fill(1) : undefined })} min={2} max={1000} integer />
        <Checkbox
          checked={Boolean(weights)}
          onChange={(on) => update({ weights: on ? new Array(source.faces).fill(1) : undefined })}
          label="Use a weighted (unfair) die"
          description="Set a relative weight per face. Weights need not sum to 1; each probability is its weight divided by the total."
        />
        {weights && source.faces <= 24 && (
          <div className="oc-matrix-grid" style={{ gridTemplateColumns: `repeat(${Math.min(6, source.faces)}, 1fr)`, marginBottom: 'var(--s3)' }}>
            {weights.map((w, i) => (
              <label key={i} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Face {i + 1}
                <RawNumberInput
                  value={w}
                  min={0}
                  ariaLabel={`Weight for face ${i + 1}`}
                  onChange={(v) => {
                    const next = [...weights];
                    next[i] = v;
                    update({ weights: next });
                  }}
                />
              </label>
            ))}
          </div>
        )}
        {weights && (
          <p className="oc-field__hint">
            Total weight {formatValue(weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), 6)}. Probabilities are shown in the theoretical
            distribution on the right.
          </p>
        )}
      </>
    );
  }

  if (source.kind === 'deck') {
    return (
      <>
        <NumberField label="Decks combined" value={source.decks} onChange={(decks) => update({ decks })} min={1} max={20} integer hint={`${source.decks * 52} cards in total.`} />
        <NumberField label="Cards drawn per repetition" value={source.draws} onChange={(draws) => update({ draws })} min={1} max={source.withReplacement ? 1000 : source.decks * 52} integer />
        <Checkbox checked={source.withReplacement} onChange={(withReplacement) => update({ withReplacement })} label="Return each card before the next draw" description="With replacement the draws are independent; without it they are dependent." />
        <div className="oc-field">
          <span className="oc-field__label">Which cards count as a success</span>
          <p className="oc-field__hint" style={{ marginTop: 0 }}>
            Select ranks and/or suits. A card counts when it matches a selected rank and a selected suit; leaving suits empty means any suit.
          </p>
          <ChipSelect options={[...CARD_RANKS]} selected={source.successRanks} onChange={(successRanks) => update({ successRanks })} label="Ranks" />
          <ChipSelect options={[...CARD_SUITS]} selected={source.successSuits} onChange={(successSuits) => update({ successSuits })} label="Suits" />
        </div>
      </>
    );
  }

  if (source.kind === 'urn') {
    const urn = source;
    const total = urn.items.reduce((a, it) => a + it.count, 0);
    const updateItem = (index: number, patch: Partial<(typeof urn.items)[number]>) =>
      update({ items: urn.items.map((x, j) => (j === index ? { ...x, ...patch } : x)) });
    return (
      <>
        <p className="oc-field__hint" style={{ marginTop: 0 }}>
          {total} object(s) in the collection.
        </p>
        {urn.items.map((it, i) => (
          <Card key={i} variant="inset">
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 110px', minWidth: 0 }}>
                <TextField label="Label" value={it.label} onChange={(label) => updateItem(i, { label })} maxLength={60} />
              </div>
              <div style={{ width: 92 }}>
                <NumberField label="Count" value={it.count} onChange={(count) => updateItem(i, { count })} min={0} max={1e6} integer />
              </div>
              <div style={{ width: 92 }}>
                <NumberField label="Value" value={it.value} onChange={(value) => updateItem(i, { value })} />
              </div>
              {urn.items.length > 1 && <Button icon="trash" variant="ghost" title={`Remove ${it.label}`} onClick={() => update({ items: urn.items.filter((_, j) => j !== i) })} />}
            </div>
            <Checkbox checked={it.success} onChange={(success) => updateItem(i, { success })} label="Counts as a success" />
          </Card>
        ))}
        <Button icon="plus" size="sm" onClick={() => update({ items: [...urn.items, { label: `Object ${urn.items.length + 1}`, count: 1, value: 0, success: false }] })}>
          Add a kind of object
        </Button>
        <hr className="oc-divider" />
        <NumberField label="Objects drawn per repetition" value={urn.draws} onChange={(draws) => update({ draws })} min={1} max={urn.withReplacement ? 10000 : Math.max(1, total)} integer />
        <Checkbox checked={urn.withReplacement} onChange={(withReplacement) => update({ withReplacement })} label="Return each object before the next draw" />
      </>
    );
  }

  // Custom outcomes
  const custom = source;
  const total = custom.faces.reduce((a, f) => a + f.weight, 0);
  const updateFace = (index: number, patch: Partial<{ label: string; value: number; weight: number }>) =>
    update({ faces: custom.faces.map((x, j) => (j === index ? { ...x, ...patch } : x)) });
  return (
    <>
      {custom.faces.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--s2)' }}>
          <div style={{ flex: '1 1 110px', minWidth: 0 }}>
            <TextField label="Outcome" value={f.label} onChange={(label) => updateFace(i, { label })} maxLength={60} />
          </div>
          <div style={{ width: 92 }}>
            <NumberField label="Weight" value={f.weight} onChange={(weight) => updateFace(i, { weight })} min={0} />
          </div>
          <div style={{ width: 92 }}>
            <NumberField label="Value" value={f.value} onChange={(value) => updateFace(i, { value })} />
          </div>
          {custom.faces.length > 1 && <Button icon="trash" variant="ghost" title={`Remove ${f.label}`} onClick={() => update({ faces: custom.faces.filter((_, j) => j !== i) })} />}
        </div>
      ))}
      <Button icon="plus" size="sm" onClick={() => update({ faces: [...custom.faces, { label: `Outcome ${custom.faces.length + 1}`, value: 0, weight: 1 }] })}>
        Add an outcome
      </Button>
      <p className="oc-field__hint">
        Total weight {formatValue(total, 6)}.{' '}
        {Math.abs(total - 1) > 1e-9
          ? `Weights are treated as relative, so each probability is its weight ÷ ${formatValue(total, 6)}. No weight is changed.`
          : 'Weights already sum to 1, so they are used directly as probabilities.'}
      </p>
      <hr className="oc-divider" />
      <NumberField label="Draws per repetition" value={custom.draws} onChange={(draws) => update({ draws })} min={1} max={10000} integer />
      <Checkbox
        checked={custom.withReplacement}
        onChange={(withReplacement) => update({ withReplacement })}
        label="Return each outcome before the next draw"
        description="Without replacement, weights must be whole numbers, because each draw removes one object."
      />
    </>
  );
}

function ChipSelect({ options, selected, onChange, label }: { options: string[]; selected: string[]; onChange(next: string[]): void; label: string }) {
  return (
    <div style={{ marginBottom: 'var(--s3)' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--s1)' }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s1)' }}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              className="oc-btn oc-btn--sm"
              style={on ? { background: 'var(--accent-dim)', borderColor: 'var(--accent)' } : undefined}
              onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
            >
              {on ? '✓ ' : ''}
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
