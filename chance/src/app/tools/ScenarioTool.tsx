/**
 * Scenario builder: define variables, dependencies, derived values and output
 * metrics, then simulate. Includes side-by-side scenario comparison.
 */
import { useMemo, useState } from 'react';
import {
  validateScenario,
  type CorrelationGroup,
  type ScenarioModelConfig,
  type ScenarioVariable,
  type VariableKind,
} from '../../engine/scenario/model';
import { DISTRIBUTIONS, defaultParams, getDistribution } from '../../engine/distributions/registry';
import { EXPRESSION_FUNCTIONS } from '../../engine/expression/expression';
import { Badge, Button, Card, Checkbox, DataTable, Disclosure, Notice, NumberField, SelectField, SliderField, TextField } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { RunPanel, SimulationSettingsCard, useSimulationRun } from '../shared/SimulationControls';
import { SimulationResults } from '../shared/SimulationResults';
import { useApp } from '../store';
import type { SimulationResult } from '../../engine/simulation/types';
import { Icon } from '../../ui/icons';

export interface ScenarioToolConfig extends ScenarioModelConfig {
  trials: number;
  seed: string;
}

export const SCENARIO_DEFAULT: ScenarioToolConfig = {
  variables: [
    { id: 'v1', name: 'units', label: 'Units sold', kind: 'distribution', distributionId: 'pert', params: { a: 800, m: 1200, b: 2000 }, integer: true, track: true },
    { id: 'v2', name: 'price', label: 'Price per unit', kind: 'distribution', distributionId: 'triangular', params: { a: 18, c: 22, b: 28 }, track: true },
    { id: 'v3', name: 'unitCost', label: 'Cost per unit', kind: 'fixed', value: 11 },
    { id: 'v4', name: 'fixedCost', label: 'Fixed costs', kind: 'fixed', value: 9000 },
    { id: 'v5', name: 'profit', label: 'Profit', kind: 'derived', expression: 'units * (price - unitCost) - fixedCost' },
  ],
  correlationGroups: [{ id: 'g1', label: 'Price and volume move together', variables: ['units', 'price'], pairs: [{ a: 'units', b: 'price', rho: -0.4 }] }],
  outputs: [
    { id: 'o1', key: 'profit', label: 'Profit', expression: 'profit', kind: 'continuous', unit: 'GBP' },
    { id: 'o2', key: 'lossRisk', label: 'Makes a loss', expression: 'profit < 0', kind: 'indicator' },
  ],
  assumptions: ['Costs are known exactly; only volume and price are uncertain.'],
  trials: 50000,
  seed: 'scenario-1',
};

const VARIABLE_KINDS: { value: VariableKind; label: string; description: string }[] = [
  { value: 'fixed', label: 'Fixed value', description: 'A number that does not vary.' },
  { value: 'distribution', label: 'Random value from a distribution', description: 'Drawn afresh in every trial.' },
  { value: 'derived', label: 'Calculated from other variables', description: 'An expression of the other variables.' },
  { value: 'categorical', label: 'One of several categories', description: 'Picks a category by weight; each category has a numeric value.' },
  { value: 'bernoulli', label: 'Happens or does not', description: 'Takes the value 1 with a given probability, otherwise 0.' },
];

export function ScenarioTool({ config }: { config: ScenarioToolConfig }) {
  const app = useApp();
  const set = (patch: Partial<ScenarioToolConfig>) => app.updateConfig({ ...config, ...patch });
  const run = useSimulationRun();
  const [comparison, setComparison] = useState<{ label: string; result: SimulationResult }[]>([]);

  const modelConfig = useMemo<ScenarioModelConfig>(
    () => ({ variables: config.variables, correlationGroups: config.correlationGroups, outputs: config.outputs, assumptions: config.assumptions }),
    [config.variables, config.correlationGroups, config.outputs, config.assumptions],
  );
  const issues = useMemo(() => validateScenario(modelConfig), [modelConfig]);

  const updateVariable = (id: string, patch: Partial<ScenarioVariable>) =>
    set({ variables: config.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  const doRun = () => run.run({ modelId: 'scenario', config: modelConfig, trials: config.trials, seed: config.seed, keepSamples: true });

  return (
    <>
      <ToolHeader
        toolId="scenario"
        extraActions={
          run.state.result ? (
            <Button
              icon="copy"
              onClick={() =>
                setComparison((prev) => [...prev.slice(-3), { label: `${app.current?.name ?? 'Scenario'} · seed ${run.state.result!.seed}`, result: run.state.result! }])
              }
            >
              Keep for comparison
            </Button>
          ) : undefined
        }
      />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Variables" hint="Each variable has a name you can use in expressions.">
            {config.variables.map((v) => (
              <VariableEditor
                key={v.id}
                variable={v}
                issues={issues.filter((i) => i.field === `variable:${v.id}`)}
                others={config.variables.filter((o) => o.id !== v.id)}
                onChange={(patch) => updateVariable(v.id, patch)}
                onRemove={
                  config.variables.length > 1
                    ? () =>
                        set({
                          variables: config.variables.filter((o) => o.id !== v.id),
                          correlationGroups: config.correlationGroups
                            .map((g) => ({ ...g, variables: g.variables.filter((n) => n !== v.name), pairs: g.pairs.filter((p) => p.a !== v.name && p.b !== v.name) }))
                            .filter((g) => g.variables.length >= 2),
                        })
                    : undefined
                }
              />
            ))}
            <Button
              icon="plus"
              size="sm"
              disabled={config.variables.length >= 40}
              onClick={() => {
                const n = config.variables.length + 1;
                set({ variables: [...config.variables, { id: `v${Date.now().toString(36)}`, name: `x${n}`, label: `Variable ${n}`, kind: 'fixed', value: 0 }] });
              }}
            >
              Add a variable
            </Button>
          </Card>

          <CorrelationEditor config={config} set={set} issues={issues} />

          <Card title="Output metrics" hint="What the simulation records in each trial.">
            {config.outputs.map((o) => (
              <Card key={o.id} variant="inset">
                <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField label="Name" value={o.label} onChange={(label) => set({ outputs: config.outputs.map((x) => (x.id === o.id ? { ...x, label } : x)) })} maxLength={120} />
                  </div>
                  {config.outputs.length > 1 && <Button icon="trash" variant="ghost" title={`Remove ${o.label}`} onClick={() => set({ outputs: config.outputs.filter((x) => x.id !== o.id) })} />}
                </div>
                <TextField
                  label="Expression"
                  value={o.expression}
                  onChange={(expression) => set({ outputs: config.outputs.map((x) => (x.id === o.id ? { ...x, expression } : x)) })}
                  monospace
                  error={issues.find((i) => i.field === `output:${o.id}`)?.message}
                  hint={`Available variables: ${config.variables.map((v) => v.name).join(', ')}`}
                />
                <SelectField
                  label="Type of output"
                  value={o.kind}
                  onChange={(kind) => set({ outputs: config.outputs.map((x) => (x.id === o.id ? { ...x, kind } : x)) })}
                  options={[
                    { value: 'continuous', label: 'A measured quantity' },
                    { value: 'discrete', label: 'A whole-number count' },
                    { value: 'indicator', label: 'Yes or no — reported as a probability' },
                  ]}
                  hint={o.kind === 'indicator' ? 'The expression should give 1 (or true) when the event happens and 0 otherwise.' : undefined}
                />
                {o.kind !== 'indicator' && <TextField label="Unit (optional)" value={o.unit ?? ''} onChange={(unit) => set({ outputs: config.outputs.map((x) => (x.id === o.id ? { ...x, unit } : x)) })} maxLength={20} />}
              </Card>
            ))}
            <Button
              icon="plus"
              size="sm"
              disabled={config.outputs.length >= 12}
              onClick={() => {
                const n = config.outputs.length + 1;
                set({ outputs: [...config.outputs, { id: `o${Date.now().toString(36)}`, key: `metric${n}`, label: `Metric ${n}`, expression: config.variables[0]?.name ?? '0', kind: 'continuous' }] });
              }}
            >
              Add an output
            </Button>
          </Card>

          <Disclosure title="Expression reference" icon="book">
            <p style={{ fontSize: 12.5 }}>
              Arithmetic: <code>+ − * / % ^</code>. Comparison: <code>&lt; &lt;= &gt; &gt;= == !=</code>. Logic: <code>and or not</code>. Conditions evaluate to
              1 or 0, so an indicator output can be written directly, for example <code>profit &lt; 0</code>.
            </p>
            <p style={{ fontSize: 12.5 }}>Functions:</p>
            <ul className="oc-assumption-list" style={{ columns: 2, columnGap: 'var(--s4)' }}>
              {EXPRESSION_FUNCTIONS.map((f) => (
                <li key={f.name} style={{ breakInside: 'avoid' }}>
                  <code>{f.name}</code> — {f.doc}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12.5, marginBottom: 0 }} className="oc-muted">
              Expressions are parsed and evaluated by the application's own parser. They cannot run code.
            </p>
          </Disclosure>

          <SimulationSettingsCard settings={{ trials: config.trials, seed: config.seed, keepSamples: true }} onChange={(s) => set({ trials: s.trials, seed: s.seed })} />

          <RunPanel state={run.state} onRun={doRun} onCancel={run.cancel} disabled={issues.length > 0} fallbackReason={run.fallbackReason} />

          <AiAssistPanel capability="buildScenario" context="Start from a template in the Templates screen, or copy one of the worked examples and change its variables." />
        </div>

        <div className="oc-stack">
          {issues.length > 0 && <Notice tone="error" title={`${issues.length} problem(s) to fix before running`} items={issues.map((i) => i.message)} />}

          {issues.length === 0 && !run.state.result && (
            <Card title="Model summary" variant="inset">
              <DataTable
                caption="Model summary"
                columns={[
                  { key: 'n', header: 'Variable', render: (r) => <code>{(r as ScenarioVariable).name}</code> },
                  { key: 'l', header: 'Label', render: (r) => (r as ScenarioVariable).label },
                  { key: 'k', header: 'How it is set', render: (r) => describeVariable(r as ScenarioVariable) },
                ]}
                rows={config.variables}
              />
              <Notice tone="info" title="Nothing has been simulated yet">
                <p>Run the model to see the distribution of each output metric.</p>
              </Notice>
            </Card>
          )}

          {run.state.result && (
            <>
              <SimulationResults result={run.state.result} />
              {comparison.length > 0 && <ComparisonPanel current={run.state.result} kept={comparison} onClear={() => setComparison([])} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function describeVariable(v: ScenarioVariable): string {
  switch (v.kind) {
    case 'fixed':
      return `Fixed at ${v.value}`;
    case 'distribution': {
      const def = getDistribution(v.distributionId ?? 'normal');
      const conditional = Object.keys(v.paramExpressions ?? {});
      return `${def.name}${conditional.length ? ` with ${conditional.join(', ')} depending on other variables` : ` (${def.params.map((p) => `${p.symbol} = ${v.params?.[p.key]}`).join(', ')})`}`;
    }
    case 'derived':
      return `Calculated: ${v.expression}`;
    case 'categorical':
      return `One of ${v.categories?.length ?? 0} categories`;
    case 'bernoulli':
      return v.probabilityExpression ? `Happens with probability ${v.probabilityExpression}` : `Happens with probability ${v.probability}`;
  }
}

function VariableEditor({
  variable,
  issues,
  others,
  onChange,
  onRemove,
}: {
  variable: ScenarioVariable;
  issues: { message: string }[];
  others: ScenarioVariable[];
  onChange(patch: Partial<ScenarioVariable>): void;
  onRemove?(): void;
}) {
  const def = variable.kind === 'distribution' ? getDistribution(variable.distributionId ?? 'normal') : null;
  const conditionalKeys = Object.keys(variable.paramExpressions ?? {});
  return (
    <Card variant="inset">
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 130px', minWidth: 0 }}>
          <TextField label="Label" value={variable.label} onChange={(label) => onChange({ label })} maxLength={120} />
        </div>
        <div style={{ width: 110 }}>
          <TextField label="Name in formulas" value={variable.name} onChange={(name) => onChange({ name })} maxLength={40} monospace />
        </div>
        {onRemove && <Button icon="trash" variant="ghost" title={`Remove ${variable.label}`} onClick={onRemove} />}
      </div>

      <SelectField
        label="How it is set"
        value={variable.kind}
        onChange={(kind) => {
          const patch: Partial<ScenarioVariable> = { kind };
          if (kind === 'fixed') patch.value = variable.value ?? 0;
          if (kind === 'distribution') {
            patch.distributionId = variable.distributionId ?? 'normal';
            patch.params = variable.params ?? defaultParams(getDistribution(patch.distributionId));
          }
          if (kind === 'derived') patch.expression = variable.expression ?? (others[0]?.name ?? '0');
          if (kind === 'categorical') patch.categories = variable.categories ?? [{ label: 'Low', value: 1, weight: 1 }, { label: 'High', value: 2, weight: 1 }];
          if (kind === 'bernoulli') patch.probability = variable.probability ?? 0.5;
          onChange(patch);
        }}
        options={VARIABLE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        hint={VARIABLE_KINDS.find((k) => k.value === variable.kind)?.description}
      />

      {variable.kind === 'fixed' && <NumberField label="Value" value={variable.value ?? 0} onChange={(value) => onChange({ value })} />}

      {variable.kind === 'distribution' && def && (
        <>
          <SelectField
            label="Distribution"
            value={def.id}
            onChange={(distributionId) => onChange({ distributionId, params: defaultParams(getDistribution(distributionId)), paramExpressions: undefined })}
            options={DISTRIBUTIONS.map((d) => ({ value: d.id, label: d.name }))}
            hint={def.description}
          />
          {def.params.map((spec) => {
            const isExpr = conditionalKeys.includes(spec.key);
            return (
              <div key={spec.key}>
                {isExpr ? (
                  <TextField
                    label={`${spec.label} (depends on other variables)`}
                    value={variable.paramExpressions?.[spec.key] ?? ''}
                    onChange={(expr) => onChange({ paramExpressions: { ...variable.paramExpressions, [spec.key]: expr } })}
                    monospace
                    hint={`Available: ${others.map((o) => o.name).join(', ') || 'no other variables yet'}`}
                  />
                ) : (
                  <SliderField
                    label={spec.label}
                    symbol={spec.symbol}
                    value={variable.params?.[spec.key] ?? spec.defaultValue}
                    onChange={(v) => onChange({ params: { ...variable.params, [spec.key]: v } })}
                    min={spec.sliderMin}
                    max={spec.sliderMax}
                    step={spec.step}
                    integer={spec.integer}
                  />
                )}
                {others.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={isExpr ? 'minus' : 'plus'}
                    onClick={() => {
                      const next = { ...variable.paramExpressions };
                      if (isExpr) delete next[spec.key];
                      else next[spec.key] = others[0].name;
                      onChange({ paramExpressions: Object.keys(next).length ? next : undefined });
                    }}
                  >
                    {isExpr ? `Use a fixed ${spec.label.toLowerCase()}` : `Make ${spec.label.toLowerCase()} depend on another variable`}
                  </Button>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
            <Checkbox checked={Boolean(variable.integer)} onChange={(integer) => onChange({ integer })} label="Round to whole numbers" />
            <Checkbox checked={Boolean(variable.track)} onChange={(track) => onChange({ track })} label="Track for sensitivity analysis" />
          </div>
        </>
      )}

      {variable.kind === 'derived' && (
        <TextField
          label="Formula"
          value={variable.expression ?? ''}
          onChange={(expression) => onChange({ expression })}
          monospace
          hint={`Available variables: ${others.map((o) => o.name).join(', ') || 'none yet'}`}
        />
      )}

      {variable.kind === 'bernoulli' && (
        <>
          {variable.probabilityExpression === undefined ? (
            <SliderField label="Probability it happens" value={variable.probability ?? 0.5} onChange={(probability) => onChange({ probability })} min={0} max={1} step={0.01} />
          ) : (
            <TextField label="Probability (formula)" value={variable.probabilityExpression} onChange={(probabilityExpression) => onChange({ probabilityExpression })} monospace />
          )}
          {others.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ probabilityExpression: variable.probabilityExpression === undefined ? others[0].name : undefined })}>
              {variable.probabilityExpression === undefined ? 'Make the probability depend on another variable' : 'Use a fixed probability'}
            </Button>
          )}
          <div style={{ marginTop: 'var(--s2)' }}>
            <Checkbox checked={Boolean(variable.track)} onChange={(track) => onChange({ track })} label="Track for sensitivity analysis" />
          </div>
        </>
      )}

      {variable.kind === 'categorical' && (
        <>
          {(variable.categories ?? []).map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end', marginBottom: 'var(--s2)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextField label="Category" value={c.label} onChange={(label) => onChange({ categories: (variable.categories ?? []).map((x, j) => (j === i ? { ...x, label } : x)) })} maxLength={60} />
              </div>
              <div style={{ width: 80 }}>
                <NumberField label="Value" value={c.value} onChange={(value) => onChange({ categories: (variable.categories ?? []).map((x, j) => (j === i ? { ...x, value } : x)) })} />
              </div>
              <div style={{ width: 80 }}>
                <NumberField label="Weight" value={c.weight} onChange={(weight) => onChange({ categories: (variable.categories ?? []).map((x, j) => (j === i ? { ...x, weight } : x)) })} min={0} />
              </div>
              {(variable.categories?.length ?? 0) > 2 && (
                <Button icon="trash" variant="ghost" title={`Remove ${c.label}`} onClick={() => onChange({ categories: (variable.categories ?? []).filter((_, j) => j !== i) })} />
              )}
            </div>
          ))}
          <Button
            size="sm"
            icon="plus"
            onClick={() => onChange({ categories: [...(variable.categories ?? []), { label: `Category ${(variable.categories?.length ?? 0) + 1}`, value: (variable.categories?.length ?? 0) + 1, weight: 1 }] })}
          >
            Add a category
          </Button>
          <p className="oc-field__hint">
            Total weight {formatValue((variable.categories ?? []).reduce((a, c) => a + c.weight, 0), 5)}; each probability is the weight divided by that total.
          </p>
          <Checkbox checked={Boolean(variable.track)} onChange={(track) => onChange({ track })} label="Track for sensitivity analysis" />
        </>
      )}

      {issues.length > 0 && <Notice tone="error" items={issues.map((i) => i.message)} />}
    </Card>
  );
}

function CorrelationEditor({ config, set, issues }: { config: ScenarioToolConfig; set(patch: Partial<ScenarioToolConfig>): void; issues: { field?: string; message: string }[] }) {
  const eligible = config.variables.filter((v) => v.kind === 'distribution' && !Object.keys(v.paramExpressions ?? {}).length);
  return (
    <Card title="Dependencies between variables" hint="Variables you do not link here are sampled independently.">
      {config.correlationGroups.map((g) => (
        <Card key={g.id} variant="inset">
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField label="Group name" value={g.label} onChange={(label) => set({ correlationGroups: config.correlationGroups.map((x) => (x.id === g.id ? { ...x, label } : x)) })} maxLength={120} />
            </div>
            <Button icon="trash" variant="ghost" title={`Remove ${g.label}`} onClick={() => set({ correlationGroups: config.correlationGroups.filter((x) => x.id !== g.id) })} />
          </div>
          <div className="oc-field">
            <span className="oc-field__label">Variables in this group</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s1)' }}>
              {eligible.map((v) => {
                const on = g.variables.includes(v.name);
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={on}
                    className="oc-btn oc-btn--sm"
                    style={on ? { background: 'var(--accent-dim)', borderColor: 'var(--accent)' } : undefined}
                    onClick={() => {
                      const variables = on ? g.variables.filter((n) => n !== v.name) : [...g.variables, v.name];
                      const pairs = g.pairs.filter((p) => variables.includes(p.a) && variables.includes(p.b));
                      set({ correlationGroups: config.correlationGroups.map((x) => (x.id === g.id ? { ...x, variables, pairs } : x)) });
                    }}
                  >
                    {on ? '✓ ' : ''}
                    {v.name}
                  </button>
                );
              })}
            </div>
          </div>
          {pairsOf(g).map(([a, b]) => {
            const existing = g.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
            return (
              <SliderField
                key={`${a}-${b}`}
                label={`Rank correlation between ${a} and ${b}`}
                value={existing?.rho ?? 0}
                onChange={(rho) => {
                  const others = g.pairs.filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a)));
                  set({ correlationGroups: config.correlationGroups.map((x) => (x.id === g.id ? { ...x, pairs: rho === 0 ? others : [...others, { a, b, rho }] } : x)) });
                }}
                min={-0.95}
                max={0.95}
                step={0.05}
                hint={describeCorrelation(existing?.rho ?? 0)}
              />
            );
          })}
          {issues.filter((i) => i.field === `group:${g.id}`).length > 0 && <Notice tone="error" items={issues.filter((i) => i.field === `group:${g.id}`).map((i) => i.message)} />}
        </Card>
      ))}
      <Button
        icon="plus"
        size="sm"
        disabled={eligible.length < 2}
        onClick={() => set({ correlationGroups: [...config.correlationGroups, { id: `g${Date.now().toString(36)}`, label: `Group ${config.correlationGroups.length + 1}`, variables: [], pairs: [] } as CorrelationGroup] })}
      >
        Add a correlation group
      </Button>
      {eligible.length < 2 && <p className="oc-field__hint">At least two variables drawn from a distribution are needed to set a correlation.</p>}
      <Notice tone="info" title="What a correlation here means">
        <p>
          Variables in a group are drawn together through a Gaussian copula, which reproduces the rank correlation you set while keeping each variable's own
          distribution. It produces no tail dependence: extreme values are no more likely to coincide than the correlation alone implies.
        </p>
      </Notice>
    </Card>
  );
}

function pairsOf(g: CorrelationGroup): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < g.variables.length; i++) for (let j = i + 1; j < g.variables.length; j++) out.push([g.variables[i], g.variables[j]]);
  return out;
}

function describeCorrelation(rho: number): string {
  if (rho === 0) return 'No correlation: the two are drawn independently.';
  const strength = Math.abs(rho) < 0.3 ? 'weak' : Math.abs(rho) < 0.6 ? 'moderate' : 'strong';
  return rho > 0 ? `A ${strength} tendency to be high or low together.` : `A ${strength} tendency for one to be high when the other is low.`;
}

function ComparisonPanel({ current, kept, onClear }: { current: SimulationResult; kept: { label: string; result: SimulationResult }[]; onClear(): void }) {
  const all = [{ label: 'Current run', result: current }, ...kept];
  const keys = current.outputs.filter((o) => o.spec.role !== 'input').map((o) => o.spec.key);
  const rows = keys.flatMap((key) =>
    all.map((entry) => {
      const o = entry.result.outputs.find((x) => x.spec.key === key);
      return o ? { metric: o.spec.label, scenario: entry.label, kind: o.spec.kind, mean: o.summary.mean, low: o.summary.quantiles.find((q) => q.p === 0.05)?.value ?? NaN, high: o.summary.quantiles.find((q) => q.p === 0.95)?.value ?? NaN, ciLow: o.estimateInterval.low, ciHigh: o.estimateInterval.high } : null;
    }).filter(Boolean),
  ) as Row[];

  return (
    <Card
      title="Scenario comparison"
      hint="Runs you kept, side by side with the current one."
      actions={
        <Button size="sm" variant="ghost" icon="x" onClick={onClear}>
          Clear
        </Button>
      }
    >
      <DataTable
        caption="Comparison of kept runs"
        columns={[
          { key: 'm', header: 'Metric', render: (r) => (r as Row).metric },
          { key: 's', header: 'Run', render: (r) => (r as Row).scenario },
          { key: 'mean', header: 'Average (or probability)', numeric: true, render: (r) => ((r as Row).kind === 'indicator' ? formatPercent((r as Row).mean, 4) : formatValue((r as Row).mean)) },
          { key: 'ci', header: '95% interval for that estimate', render: (r) => `${formatValue((r as Row).ciLow, 4)} – ${formatValue((r as Row).ciHigh, 4)}` },
          { key: 'range', header: '5th–95th percentile of outcomes', render: (r) => ((r as Row).kind === 'indicator' ? '—' : `${formatValue((r as Row).low, 4)} – ${formatValue((r as Row).high, 4)}`) },
        ]}
        rows={rows}
      />
      <Notice tone="warning" title="How to read a difference between runs">
        <p>
          Each run uses a different random stream, so two runs of the same model differ by sampling error alone. A difference between runs is only meaningful
          when it is larger than the intervals in the table. To compare scenarios more precisely, use the same seed in both so the random draws line up.
        </p>
      </Notice>
      <p className="oc-chart-note" style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
        <Icon name="info" size={12} /> <Badge>Up to 4 runs are kept</Badge>
      </p>
    </Card>
  );
}

interface Row {
  metric: string;
  scenario: string;
  kind: string;
  mean: number;
  low: number;
  high: number;
  ciLow: number;
  ciHigh: number;
}
