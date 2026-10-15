/**
 * Sensitivity analysis: parameter sweeps, tornado comparison, rank
 * correlation on a simulated sample, and Sobol variance decomposition.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SENSITIVITY_LIMITS,
  getByPath,
  rankCorrelations,
  validateSweep,
  type RankCorrelationResult,
  type SobolResult,
  type SweepRequest,
  type SweepResult,
  type TornadoResult,
} from '../../engine/sensitivity/sensitivity';
import { validateScenario, type ScenarioModelConfig } from '../../engine/scenario/model';
import { EngineError, type Issue } from '../../engine/core/result';
import { Button, Card, DataTable, Notice, NumberField, RunningState, SelectField, TextField } from '../../ui/primitives';
import { formatPercent, formatValue, seriesColor } from '../../ui/charts/scale';
import { LineChart, TornadoChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { AssumptionsPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';
import { getSimulationClient } from '../../workers/client';
import { downloadText, toCsv } from '../../persistence/store';
import { SCENARIO_DEFAULT } from './ScenarioTool';

export type SensitivityMethod = 'sweep' | 'tornado' | 'rank' | 'sobol';

export interface SensitivityToolConfig {
  method: SensitivityMethod;
  /** The scenario being analysed. Sensitivity always works on a scenario model. */
  scenario: ScenarioModelConfig;
  outputKey: string;
  sweep: { parameterPath: string; parameterLabel: string; min: number; max: number; steps: number; trialsPerPoint: number };
  tornado: { parameters: { path: string; label: string; low: number; high: number }[]; trialsPerPoint: number };
  sobol: { parameters: { path: string; label: string; low: number; high: number }[]; samples: number; trialsPerEvaluation: number };
  rank: { trials: number };
  seed: string;
}

export const SENSITIVITY_DEFAULT: SensitivityToolConfig = {
  method: 'tornado',
  scenario: {
    variables: SCENARIO_DEFAULT.variables,
    correlationGroups: [],
    outputs: SCENARIO_DEFAULT.outputs,
    assumptions: SCENARIO_DEFAULT.assumptions,
  },
  outputKey: 'profit',
  sweep: { parameterPath: 'variables.2.value', parameterLabel: 'Cost per unit', min: 8, max: 16, steps: 9, trialsPerPoint: 4000 },
  tornado: {
    parameters: [
      { path: 'variables.2.value', label: 'Cost per unit', low: 9, high: 13 },
      { path: 'variables.3.value', label: 'Fixed costs', low: 7000, high: 11000 },
    ],
    trialsPerPoint: 6000,
  },
  sobol: {
    parameters: [
      { path: 'variables.2.value', label: 'Cost per unit', low: 9, high: 13 },
      { path: 'variables.3.value', label: 'Fixed costs', low: 7000, high: 11000 },
    ],
    samples: 256,
    trialsPerEvaluation: 400,
  },
  rank: { trials: 20000 },
  seed: 'sensitivity-1',
};

const METHODS: { value: SensitivityMethod; label: string; description: string; caveat: string }[] = [
  {
    value: 'sweep',
    label: 'Vary one parameter across a range',
    description: 'Re-runs the model with one parameter set to each value across a range, holding everything else at its baseline.',
    caveat: 'Shows the shape of the relationship precisely, but only along one axis: interactions between parameters are invisible.',
  },
  {
    value: 'tornado',
    label: 'Compare several parameters (tornado)',
    description: 'Sets each parameter to a low and a high value in turn and sorts them by how much the output moved.',
    caveat: 'The ranking depends entirely on the ranges you choose. A parameter given a wider range will look more influential.',
  },
  {
    value: 'rank',
    label: 'Rank correlation with sampled inputs',
    description: 'Runs the model once and measures how strongly each sampled input moves with the output, across the trials.',
    caveat: 'Measures monotonic association within the model, not causation in the real system, and not a share of variance.',
  },
  {
    value: 'sobol',
    label: 'Variance decomposition (Sobol indices)',
    description: 'Splits the output variance into the share explained by each input alone and the share involving interactions.',
    caveat: 'Needs many model runs and assumes the inputs vary independently over the ranges you set.',
  },
];

export function SensitivityTool({ config }: { config: SensitivityToolConfig }) {
  const app = useApp();
  const set = (patch: Partial<SensitivityToolConfig>) => app.updateConfig({ ...config, ...patch });
  const client = getSimulationClient();
  const cancelRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  // Cancel any analysis still running when the user leaves this screen, so the
  // worker is not left computing a result nothing will display.
  useEffect(() => () => cancelRef.current?.(), []);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [issuesFromRun, setIssuesFromRun] = useState<Issue[]>([]);
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [tornado, setTornado] = useState<TornadoResult | null>(null);
  const [rank, setRank] = useState<RankCorrelationResult | null>(null);
  const [sobol, setSobol] = useState<SobolResult | null>(null);

  const scenarioIssues = useMemo(() => validateScenario(config.scenario), [config.scenario]);
  const availableOutputs = config.scenario.outputs;
  const method = METHODS.find((m) => m.value === config.method)!;

  /** Numeric paths in the scenario that can be varied. */
  const parameterChoices = useMemo(() => {
    const out: { path: string; label: string; value: number }[] = [];
    config.scenario.variables.forEach((v, i) => {
      if (v.kind === 'fixed' && typeof v.value === 'number') {
        out.push({ path: `variables.${i}.value`, label: `${v.label} (fixed value)`, value: v.value });
      }
      if (v.kind === 'distribution' && v.params) {
        for (const [key, value] of Object.entries(v.params)) {
          out.push({ path: `variables.${i}.params.${key}`, label: `${v.label} — ${key}`, value });
        }
      }
      if (v.kind === 'bernoulli' && typeof v.probability === 'number') {
        out.push({ path: `variables.${i}.probability`, label: `${v.label} — probability`, value: v.probability });
      }
    });
    return out;
  }, [config.scenario.variables]);

  const clearResults = () => {
    setSweep(null);
    setTornado(null);
    setRank(null);
    setSobol(null);
    setIssuesFromRun([]);
  };

  const handleError = (e: unknown) => {
    setIssuesFromRun(e instanceof EngineError ? e.issues : [{ code: 'unexpected', message: e instanceof Error ? e.message : String(e) }]);
    setStatus('idle');
  };

  const runAnalysis = () => {
    clearResults();
    setStatus('running');
    const onProgress = (done: number, total: number) => setProgress({ done, total });
    if (config.method === 'sweep') {
      const request: SweepRequest = {
        modelId: 'scenario',
        baseConfig: config.scenario,
        parameterPath: config.sweep.parameterPath,
        parameterLabel: config.sweep.parameterLabel,
        outputKey: config.outputKey,
        min: config.sweep.min,
        max: config.sweep.max,
        steps: config.sweep.steps,
        trialsPerPoint: config.sweep.trialsPerPoint,
        seed: config.seed,
      };
      const pre = validateSweep(request);
      if (pre.length) {
        setIssuesFromRun(pre);
        setStatus('idle');
        return;
      }
      setProgress({ done: 0, total: config.sweep.steps });
      const job = client.sweep(request, { onProgress });
      cancelRef.current = job.cancel;
      void job.promise.then((r) => { setSweep(r); setStatus('idle'); }).catch(handleError);
    } else if (config.method === 'tornado') {
      setProgress({ done: 0, total: config.tornado.parameters.length });
      const job = client.tornado(
        { modelId: 'scenario', baseConfig: config.scenario, outputKey: config.outputKey, parameters: config.tornado.parameters, trialsPerPoint: config.tornado.trialsPerPoint, seed: config.seed },
        { onProgress },
      );
      cancelRef.current = job.cancel;
      void job.promise.then((r) => { setTornado(r); setStatus('idle'); }).catch(handleError);
    } else if (config.method === 'rank') {
      setProgress({ done: 0, total: config.rank.trials });
      const job = client.run({ modelId: 'scenario', config: config.scenario, trials: config.rank.trials, seed: config.seed, keepSamples: true }, { onProgress });
      cancelRef.current = job.cancel;
      void job.promise
        .then((result) => {
          try {
            setRank(rankCorrelations(result, config.outputKey));
          } catch (e) {
            handleError(e);
            return;
          }
          setStatus('idle');
        })
        .catch(handleError);
    } else {
      const total = config.sobol.samples * (config.sobol.parameters.length + 2);
      setProgress({ done: 0, total });
      const job = client.sobol(
        {
          modelId: 'scenario',
          config: config.scenario,
          outputKey: config.outputKey,
          parameters: config.sobol.parameters,
          samples: config.sobol.samples,
          trialsPerEvaluation: config.sobol.trialsPerEvaluation,
          seed: config.seed,
        },
        { onProgress },
      );
      cancelRef.current = job.cancel;
      void job.promise.then((r) => { setSobol(r); setStatus('idle'); }).catch(handleError);
    }
  };

  const modelRunEstimate = useMemo(() => {
    switch (config.method) {
      case 'sweep':
        return config.sweep.steps * config.sweep.trialsPerPoint + config.sweep.trialsPerPoint;
      case 'tornado':
        return (config.tornado.parameters.length * 2 + 1) * config.tornado.trialsPerPoint;
      case 'rank':
        return config.rank.trials;
      case 'sobol':
        return config.sobol.samples * (config.sobol.parameters.length + 2) * config.sobol.trialsPerEvaluation;
    }
  }, [config]);

  return (
    <>
      <ToolHeader toolId="sensitivity" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Method">
            <SelectField label="How to measure sensitivity" value={config.method} onChange={(method) => { set({ method }); clearResults(); }} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} hint={method.description} />
            <Notice tone="warning" title="What this method cannot tell you">
              <p>{method.caveat}</p>
            </Notice>
          </Card>

          <Card title="Model and output">
            <p className="oc-field__hint" style={{ marginTop: 0 }}>
              Sensitivity analysis runs on a scenario model. The model used here is the one stored with this investigation; build or edit it in the Scenario
              Builder and save it, then open it here.
            </p>
            <SelectField
              label="Output to analyse"
              value={config.outputKey}
              onChange={(outputKey) => { set({ outputKey }); clearResults(); }}
              options={availableOutputs.map((o) => ({ value: o.key, label: o.label }))}
            />
            {scenarioIssues.length > 0 && <Notice tone="error" title="The model has problems that must be fixed first" items={scenarioIssues.map((i) => i.message)} />}
          </Card>

          {config.method === 'sweep' && (
            <Card title="Sweep settings">
              <SelectField
                label="Parameter to vary"
                value={config.sweep.parameterPath}
                onChange={(parameterPath) => {
                  const choice = parameterChoices.find((c) => c.path === parameterPath);
                  const v = choice?.value ?? 0;
                  set({ sweep: { ...config.sweep, parameterPath, parameterLabel: choice?.label ?? parameterPath, min: v * 0.7, max: v * 1.3 } });
                }}
                options={parameterChoices.map((c) => ({ value: c.path, label: c.label }))}
              />
              <NumberField label="Lowest value" value={config.sweep.min} onChange={(min) => set({ sweep: { ...config.sweep, min } })} />
              <NumberField label="Highest value" value={config.sweep.max} onChange={(max) => set({ sweep: { ...config.sweep, max } })} />
              <NumberField label="Number of points" value={config.sweep.steps} onChange={(steps) => set({ sweep: { ...config.sweep, steps } })} min={2} max={SENSITIVITY_LIMITS.maxSteps} integer />
              <NumberField label="Trials at each point" value={config.sweep.trialsPerPoint} onChange={(trialsPerPoint) => set({ sweep: { ...config.sweep, trialsPerPoint } })} min={1} max={SENSITIVITY_LIMITS.maxTrialsPerPoint} integer />
              <p className="oc-field__hint">
                Baseline value: {formatValue(safeGet(config.scenario, config.sweep.parameterPath))}. Each point is a full simulation, so the whole sweep runs
                about {modelRunEstimate.toLocaleString('en-US')} trials.
              </p>
            </Card>
          )}

          {(config.method === 'tornado' || config.method === 'sobol') && (
            <Card title={config.method === 'tornado' ? 'Parameters to compare' : 'Inputs to decompose'}>
              {(config.method === 'tornado' ? config.tornado.parameters : config.sobol.parameters).map((p, i) => (
                <Card key={i} variant="inset">
                  <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SelectField
                        label={`Parameter ${i + 1}`}
                        value={p.path}
                        onChange={(path) => {
                          const choice = parameterChoices.find((c) => c.path === path);
                          const v = choice?.value ?? 0;
                          updateParam(i, { path, label: choice?.label ?? path, low: v * 0.8, high: v * 1.2 });
                        }}
                        options={parameterChoices.map((c) => ({ value: c.path, label: c.label }))}
                      />
                    </div>
                    <Button icon="trash" variant="ghost" title={`Remove ${p.label}`} onClick={() => removeParam(i)} />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <div style={{ flex: 1 }}>
                      <NumberField label="Low value" value={p.low} onChange={(low) => updateParam(i, { low })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <NumberField label="High value" value={p.high} onChange={(high) => updateParam(i, { high })} />
                    </div>
                  </div>
                  <TextField label="Label" value={p.label} onChange={(label) => updateParam(i, { label })} maxLength={80} />
                </Card>
              ))}
              <Button icon="plus" size="sm" disabled={parameterChoices.length === 0} onClick={addParam}>
                Add a parameter
              </Button>
              {config.method === 'sobol' && (
                <>
                  <hr className="oc-divider" />
                  <NumberField label="Base sample size" value={config.sobol.samples} onChange={(samples) => set({ sobol: { ...config.sobol, samples } })} min={16} max={SENSITIVITY_LIMITS.maxSobolSamples} integer hint="Total model evaluations are N × (number of inputs + 2)." />
                  <NumberField label="Trials per evaluation" value={config.sobol.trialsPerEvaluation} onChange={(trialsPerEvaluation) => set({ sobol: { ...config.sobol, trialsPerEvaluation } })} min={1} max={20000} integer hint="Each evaluation is itself a simulation; more trials reduce the noise in each point." />
                  <Notice tone={modelRunEstimate > 20_000_000 ? 'warning' : 'info'} title="Computational cost">
                    <p>
                      This configuration will run about {modelRunEstimate.toLocaleString('en-US')} trials in total across{' '}
                      {(config.sobol.samples * (config.sobol.parameters.length + 2)).toLocaleString('en-US')} model evaluations
                      {modelRunEstimate > 20_000_000 ? '. That is likely to take several minutes. Reduce the sample size or the trials per evaluation.' : '.'}
                    </p>
                  </Notice>
                </>
              )}
            </Card>
          )}

          {config.method === 'rank' && (
            <Card title="Sampling settings">
              <NumberField label="Trials" value={config.rank.trials} onChange={(trials) => set({ rank: { ...config.rank, trials } })} min={100} max={500000} integer />
              <Notice tone="info" title="Tracked inputs only">
                <p>
                  Only variables marked "Track for sensitivity analysis" in the Scenario Builder are recorded and analysed. Currently tracked:{' '}
                  {config.scenario.variables.filter((v) => v.track).map((v) => v.label).join(', ') || 'none — mark at least one variable as tracked.'}
                </p>
              </Notice>
            </Card>
          )}

          <Card title="Seed">
            <TextField label="Random seed" value={config.seed} onChange={(seed) => set({ seed })} monospace maxLength={64} />
          </Card>

          {status === 'running' ? (
            <RunningState completed={progress.done} total={progress.total} unitLabel={config.method === 'sobol' ? 'model evaluations' : config.method === 'rank' ? 'trials' : 'points'} onCancel={() => cancelRef.current?.()} />
          ) : (
            <Button variant="primary" icon="play" block onClick={runAnalysis} disabled={scenarioIssues.length > 0 || (config.method !== 'rank' && config.method !== 'sweep' && (config.method === 'sobol' ? config.sobol.parameters.length < 2 : config.tornado.parameters.length < 1))}>
              Run sensitivity analysis
            </Button>
          )}

          <AiAssistPanel capability="suggestFollowUps" context="The methods above each state what they measure and what they cannot tell you; start with a tornado chart to find the biggest movers, then sweep those individually." />
        </div>

        <div className="oc-stack">
          {issuesFromRun.length > 0 && <Notice tone="error" title="The analysis could not be completed" items={issuesFromRun.map((i) => i.message)} />}

          {!sweep && !tornado && !rank && !sobol && status === 'idle' && issuesFromRun.length === 0 && (
            <Card>
              <Notice tone="info" title="Nothing analysed yet">
                <p>Choose a method and run the analysis. Each method runs the model many times, so results are real computations rather than estimates of estimates.</p>
              </Notice>
            </Card>
          )}

          {sweep && <SweepResults sweep={sweep} outputLabel={availableOutputs.find((o) => o.key === config.outputKey)?.label ?? config.outputKey} />}
          {tornado && <TornadoResults tornado={tornado} outputLabel={availableOutputs.find((o) => o.key === config.outputKey)?.label ?? config.outputKey} />}
          {rank && <RankResults rank={rank} />}
          {sobol && <SobolResults sobol={sobol} />}
        </div>
      </div>
    </>
  );

  function updateParam(i: number, patch: Partial<{ path: string; label: string; low: number; high: number }>) {
    if (config.method === 'tornado') set({ tornado: { ...config.tornado, parameters: config.tornado.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) } });
    else set({ sobol: { ...config.sobol, parameters: config.sobol.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) } });
  }

  function removeParam(i: number) {
    if (config.method === 'tornado') set({ tornado: { ...config.tornado, parameters: config.tornado.parameters.filter((_, j) => j !== i) } });
    else set({ sobol: { ...config.sobol, parameters: config.sobol.parameters.filter((_, j) => j !== i) } });
  }

  function addParam() {
    const used = (config.method === 'tornado' ? config.tornado.parameters : config.sobol.parameters).map((p) => p.path);
    const choice = parameterChoices.find((c) => !used.includes(c.path)) ?? parameterChoices[0];
    if (!choice) return;
    const next = { path: choice.path, label: choice.label, low: choice.value * 0.8, high: choice.value * 1.2 };
    if (config.method === 'tornado') set({ tornado: { ...config.tornado, parameters: [...config.tornado.parameters, next] } });
    else set({ sobol: { ...config.sobol, parameters: [...config.sobol.parameters, next] } });
  }
}

function safeGet(config: unknown, path: string): number {
  try {
    return getByPath(config, path);
  } catch {
    return NaN;
  }
}

function SweepResults({ sweep, outputLabel }: { sweep: SweepResult; outputLabel: string }) {
  return (
    <>
      <Card title={`Effect of ${sweep.parameterLabel} on ${outputLabel}`}>
        <LineChart
          title={`${outputLabel} against ${sweep.parameterLabel}`}
          description={`How the average ${outputLabel} changes as ${sweep.parameterLabel} is varied, with a 95% interval at each point.`}
          series={[
            { label: `Average ${outputLabel}`, points: sweep.points.map((p) => ({ x: p.parameterValue, y: p.outputMean })) },
            { label: 'Upper 95% bound', points: sweep.points.map((p) => ({ x: p.parameterValue, y: p.outputHigh })), dashed: true },
            { label: 'Lower 95% bound', points: sweep.points.map((p) => ({ x: p.parameterValue, y: p.outputLow })), dashed: true },
          ]}
          xLabel={sweep.parameterLabel}
          yLabel={`Average ${outputLabel}`}
          referenceLines={[{ value: sweep.baselineValue, label: 'Baseline', axis: 'x' }]}
          note="Each point is a separate simulation. The dashed bounds show Monte Carlo error: differences smaller than the gap between them are not meaningful."
          onExport={() => downloadText('sweep.csv', toCsv(['parameter_value', 'output_mean', 'ci_low', 'ci_high', 'standard_error'], sweep.points.map((p) => [p.parameterValue, p.outputMean, p.outputLow, p.outputHigh, p.standardError])))}
        />
      </Card>
      <Card title="Local sensitivity at the baseline">
        <div className="oc-figure-grid">
          <Fig label="Baseline parameter value" value={formatValue(sweep.baselineValue)} />
          <Fig label={`Baseline ${outputLabel}`} value={formatValue(sweep.baselineOutput)} />
          <Fig label="Slope" value={sweep.localGradient === null ? 'not available' : formatValue(sweep.localGradient, 5)} sub={sweep.localGradient === null ? 'The baseline is outside the swept range' : `Change in ${outputLabel} per unit change in ${sweep.parameterLabel}`} />
          <Fig label="Elasticity" value={sweep.elasticity === null ? 'not available' : formatValue(sweep.elasticity, 4)} sub="Percentage change in the output per 1% change in the parameter" />
        </div>
        {sweep.elasticity !== null && (
          <p className="oc-chart-note">
            An elasticity of {formatValue(sweep.elasticity, 3)} means a 1% increase in {sweep.parameterLabel} changes {outputLabel} by about{' '}
            {formatValue(sweep.elasticity, 3)}% near the baseline. This is a local figure: it does not hold far from the baseline if the relationship is curved.
          </p>
        )}
      </Card>
      <AssumptionsPanel assumptions={[sweep.method]} limitations={sweep.limitations} title="Method and limitations" />
    </>
  );
}

function TornadoResults({ tornado, outputLabel }: { tornado: TornadoResult; outputLabel: string }) {
  return (
    <>
      <Card>
        <TornadoChart
          title={`What moves ${outputLabel} most`}
          description="For each parameter, the output at its low and high value, sorted by the size of the swing."
          entries={tornado.entries}
          baseline={tornado.baselineOutput}
          onExport={() => downloadText('tornado.csv', toCsv(['parameter', 'low_input', 'high_input', 'output_low', 'output_high', 'swing'], tornado.entries.map((e) => [e.parameterLabel, e.low, e.high, e.lowOutput, e.highOutput, e.swing])))}
        />
      </Card>
      <Card title="Parameter effects in detail">
        <DataTable
          caption="Tornado detail"
          columns={[
            { key: 'p', header: 'Parameter', render: (r) => (r as TornadoResult['entries'][number]).parameterLabel },
            { key: 'r', header: 'Range tested', render: (r) => `${formatValue((r as TornadoResult['entries'][number]).low, 4)} → ${formatValue((r as TornadoResult['entries'][number]).high, 4)}` },
            { key: 'o', header: `${outputLabel} across that range`, render: (r) => `${formatValue((r as TornadoResult['entries'][number]).lowOutput, 4)} → ${formatValue((r as TornadoResult['entries'][number]).highOutput, 4)}` },
            { key: 's', header: 'Swing', numeric: true, render: (r) => formatValue((r as TornadoResult['entries'][number]).swing, 4) },
            { key: 'd', header: 'Direction', render: (r) => ((r as TornadoResult['entries'][number]).increasing ? 'Output rises with the parameter' : 'Output falls as the parameter rises') },
          ]}
          rows={tornado.entries}
        />
      </Card>
      <AssumptionsPanel assumptions={[tornado.method]} limitations={tornado.limitations} title="Method and limitations" />
    </>
  );
}

function RankResults({ rank }: { rank: RankCorrelationResult }) {
  return (
    <>
      <Card title="Rank correlation between inputs and the output">
        <DataTable
          caption="Rank correlation results"
          columns={[
            { key: 'i', header: 'Input', render: (r) => (r as RankCorrelationResult['entries'][number]).inputLabel },
            { key: 's', header: 'Spearman', numeric: true, render: (r) => (Number.isNaN((r as RankCorrelationResult['entries'][number]).spearman) ? '—' : formatValue((r as RankCorrelationResult['entries'][number]).spearman, 4)) },
            { key: 'p', header: 'Pearson', numeric: true, render: (r) => (Number.isNaN((r as RankCorrelationResult['entries'][number]).pearson) ? '—' : formatValue((r as RankCorrelationResult['entries'][number]).pearson, 4)) },
            { key: 'r', header: 'Relative share', numeric: true, render: (r) => (Number.isNaN((r as RankCorrelationResult['entries'][number]).relativeImportance) ? '—' : formatPercent((r as RankCorrelationResult['entries'][number]).relativeImportance, 3)) },
            { key: 'n', header: 'Note', render: (r) => (r as RankCorrelationResult['entries'][number]).note ?? '' },
          ]}
          rows={rank.entries}
        />
        <div className="oc-figure-grid" style={{ marginTop: 'var(--s4)' }}>
          {rank.entries.filter((e) => Number.isFinite(e.spearman)).slice(0, 6).map((e) => (
            <div key={e.inputKey} className="oc-figure">
              <span className="oc-figure__label">{e.inputLabel}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
                <div style={{ flex: 1, height: 8, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: e.spearman >= 0 ? '50%' : `${50 - Math.abs(e.spearman) * 50}%`,
                      width: `${Math.abs(e.spearman) * 50}%`,
                      height: '100%',
                      background: e.spearman >= 0 ? seriesColor(0) : seriesColor(1),
                    }}
                  />
                  <div style={{ position: 'absolute', left: '50%', width: 1, height: '100%', background: 'var(--axis)' }} />
                </div>
                <span className="tnum" style={{ fontSize: 12, minWidth: 48, textAlign: 'right' }}>{formatValue(e.spearman, 3)}</span>
              </div>
              <div className="oc-figure__sub">{e.spearman >= 0 ? 'Output rises with this input' : 'Output falls as this input rises'}</div>
            </div>
          ))}
        </div>
      </Card>
      <AssumptionsPanel assumptions={[rank.method]} limitations={rank.limitations} title="Method and limitations" />
    </>
  );
}

function SobolResults({ sobol }: { sobol: SobolResult }) {
  return (
    <>
      <Card title="Share of the output variance explained by each input">
        <DataTable
          caption="Sobol sensitivity indices"
          columns={[
            { key: 'p', header: 'Input', render: (r) => (r as SobolResult['entries'][number]).parameterLabel },
            { key: 'f', header: 'First-order index', numeric: true, title: 'Share of variance from this input alone', render: (r) => formatPercent((r as SobolResult['entries'][number]).firstOrder, 3) },
            { key: 't', header: 'Total index', numeric: true, title: 'Share including every interaction involving this input', render: (r) => formatPercent((r as SobolResult['entries'][number]).total, 3) },
            { key: 'i', header: 'From interactions', numeric: true, render: (r) => formatPercent((r as SobolResult['entries'][number]).interaction, 3) },
          ]}
          rows={sobol.entries}
        />
        <div className="oc-figure-grid" style={{ marginTop: 'var(--s4)' }}>
          <Fig label="Output variance" value={formatValue(sobol.outputVariance, 5)} />
          <Fig label="First-order indices sum to" value={formatPercent(sobol.firstOrderSum, 4)} sub={sobol.firstOrderSum < 0.8 ? 'Well below 100%: interactions matter' : 'Close to 100%: the inputs act mostly independently'} />
          <Fig label="Model evaluations used" value={sobol.modelRuns.toLocaleString('en-US')} />
        </div>
        <p className="oc-chart-note">
          A first-order index is the share of the output variance removed if that input were held fixed at its average effect. A total index also counts the
          input's part in interactions, so the total is always at least the first-order value; the gap between them is interaction.
        </p>
      </Card>
      <AssumptionsPanel assumptions={[sobol.method]} limitations={sobol.limitations} title="Method and limitations" />
    </>
  );
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
