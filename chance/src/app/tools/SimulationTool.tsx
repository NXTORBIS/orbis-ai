/**
 * Monte Carlo simulation of a built-in model.
 */
import { useMemo } from 'react';
import { DISTRIBUTIONS, defaultParams, getDistribution, validateParams } from '../../engine/distributions/registry';
import { Button, Card, Notice, NumberField, SelectField, SliderField, TextField } from '../../ui/primitives';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { RunPanel, SimulationSettingsCard, useSimulationRun } from '../shared/SimulationControls';
import { SimulationResults } from '../shared/SimulationResults';
import { useApp } from '../store';
import { getSimulationModel } from '../../engine/simulation/registry';
import { validateTransitionMatrix } from '../../engine/simulation/models';
import { MatrixEditor } from './shared/MatrixEditor';

export type BuiltInModelId = 'pi-estimation' | 'dice-sum' | 'project-schedule' | 'queue' | 'sampling-distribution' | 'markov-chain';

export interface SimulationToolConfig {
  modelId: BuiltInModelId;
  trials: number;
  seed: string;
  pi: Record<string, never>;
  dice: { diceCount: number; faces: number; threshold: number };
  project: { tasks: { id: string; name: string; distributionId: string; params: Record<string, number>; dependsOn: string[] }[]; deadline: number; unit: string };
  queue: { arrivalRate: number; serviceRate: number; customers: number };
  sampling: { distributionId: string; params: Record<string, number>; sampleSize: number; statistic: 'mean' | 'median' | 'max' | 'sd' };
  markov: { states: string[]; matrix: number[][]; initialState: number; steps: number; targetState: number };
}

export const SIMULATION_DEFAULT: SimulationToolConfig = {
  modelId: 'pi-estimation',
  trials: 100000,
  seed: 'pi-run-1',
  pi: {},
  dice: { diceCount: 3, faces: 6, threshold: 12 },
  project: {
    tasks: [
      { id: 'design', name: 'Design', distributionId: 'pert', params: { a: 3, m: 5, b: 10 }, dependsOn: [] },
      { id: 'build', name: 'Build', distributionId: 'pert', params: { a: 8, m: 12, b: 25 }, dependsOn: ['design'] },
      { id: 'test', name: 'Test', distributionId: 'pert', params: { a: 3, m: 5, b: 14 }, dependsOn: ['build'] },
      { id: 'docs', name: 'Documentation', distributionId: 'pert', params: { a: 2, m: 4, b: 9 }, dependsOn: ['design'] },
    ],
    deadline: 25,
    unit: 'days',
  },
  queue: { arrivalRate: 0.8, serviceRate: 1, customers: 2000 },
  sampling: { distributionId: 'exponential', params: { lambda: 1 }, sampleSize: 25, statistic: 'mean' },
  markov: {
    states: ['Working', 'Degraded', 'Failed'],
    matrix: [
      [0.9, 0.08, 0.02],
      [0.3, 0.6, 0.1],
      [0, 0, 1],
    ],
    initialState: 0,
    steps: 50,
    targetState: 2,
  },
};

const MODELS: { value: BuiltInModelId; label: string }[] = [
  { value: 'pi-estimation', label: 'Estimating π by random sampling' },
  { value: 'dice-sum', label: 'Sum of dice' },
  { value: 'project-schedule', label: 'Project completion time' },
  { value: 'queue', label: 'Single-server queue' },
  { value: 'sampling-distribution', label: 'Sampling variation' },
  { value: 'markov-chain', label: 'Markov chain path' },
];

function configFor(config: SimulationToolConfig): unknown {
  switch (config.modelId) {
    case 'pi-estimation':
      return { method: 'quarter-circle' };
    case 'dice-sum':
      return config.dice;
    case 'project-schedule':
      return config.project;
    case 'queue':
      return config.queue;
    case 'sampling-distribution':
      return config.sampling;
    case 'markov-chain':
      return config.markov;
  }
}

export function SimulationTool({ config }: { config: SimulationToolConfig }) {
  const app = useApp();
  const set = (patch: Partial<SimulationToolConfig>) => app.updateConfig({ ...config, ...patch });
  const run = useSimulationRun();

  const modelConfig = useMemo(() => configFor(config), [config]);
  const model = useMemo(() => getSimulationModel(config.modelId), [config.modelId]);
  const issues = useMemo(() => model.validate(modelConfig as never), [model, modelConfig]);

  return (
    <>
      <ToolHeader toolId="simulation" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Model">
            <SelectField label="What to simulate" value={config.modelId} onChange={(modelId) => set({ modelId })} options={MODELS} hint={model.description} />
          </Card>

          {config.modelId === 'dice-sum' && (
            <Card title="Dice settings">
              <NumberField label="Number of dice" value={config.dice.diceCount} onChange={(diceCount) => set({ dice: { ...config.dice, diceCount } })} min={1} max={200} integer />
              <NumberField label="Faces per die" value={config.dice.faces} onChange={(faces) => set({ dice: { ...config.dice, faces } })} min={2} max={1000} integer />
              <NumberField label={'Threshold for the "at least" output'} value={config.dice.threshold} onChange={(threshold) => set({ dice: { ...config.dice, threshold } })} />
            </Card>
          )}

          {config.modelId === 'queue' && (
            <Card title="Queue settings">
              <SliderField label="Arrival rate" symbol="λ" value={config.queue.arrivalRate} onChange={(arrivalRate) => set({ queue: { ...config.queue, arrivalRate } })} min={0.05} max={2} step={0.05} hint="Customers arriving per unit time." />
              <SliderField label="Service rate" symbol="μ" value={config.queue.serviceRate} onChange={(serviceRate) => set({ queue: { ...config.queue, serviceRate } })} min={0.05} max={3} step={0.05} hint="Customers served per unit time when busy." />
              <NumberField label="Customers per trial" value={config.queue.customers} onChange={(customers) => set({ queue: { ...config.queue, customers } })} min={1} max={20000} integer />
              <Notice tone={config.queue.arrivalRate >= config.queue.serviceRate ? 'warning' : 'info'} title={`Utilisation ρ = ${(config.queue.arrivalRate / config.queue.serviceRate).toFixed(3)}`}>
                <p>
                  {config.queue.arrivalRate >= config.queue.serviceRate
                    ? 'Arrivals are at least as fast as service, so the queue grows without limit. There is no steady state, and the average wait depends on how many customers you simulate.'
                    : 'Arrivals are slower than service, so the queue has a steady state. The exact long-run average wait is shown with the results for comparison.'}
                </p>
              </Notice>
            </Card>
          )}

          {config.modelId === 'sampling-distribution' && (
            <Card title="Sampling settings">
              <SelectField
                label="Distribution to sample from"
                value={config.sampling.distributionId}
                onChange={(distributionId) => set({ sampling: { ...config.sampling, distributionId, params: defaultParams(getDistribution(distributionId)) } })}
                options={DISTRIBUTIONS.map((d) => ({ value: d.id, label: d.name }))}
              />
              {getDistribution(config.sampling.distributionId).params.map((spec) => (
                <SliderField
                  key={spec.key}
                  label={spec.label}
                  symbol={spec.symbol}
                  value={config.sampling.params[spec.key] ?? spec.defaultValue}
                  onChange={(v) => set({ sampling: { ...config.sampling, params: { ...config.sampling.params, [spec.key]: v } } })}
                  min={spec.sliderMin}
                  max={spec.sliderMax}
                  step={spec.step}
                  integer={spec.integer}
                />
              ))}
              <NumberField label="Sample size per trial" symbol="n" value={config.sampling.sampleSize} onChange={(sampleSize) => set({ sampling: { ...config.sampling, sampleSize } })} min={1} max={100000} integer />
              <SelectField
                label="Statistic to record"
                value={config.sampling.statistic}
                onChange={(statistic) => set({ sampling: { ...config.sampling, statistic } })}
                options={[
                  { value: 'mean', label: 'Sample mean' },
                  { value: 'median', label: 'Sample median' },
                  { value: 'sd', label: 'Sample standard deviation' },
                  { value: 'max', label: 'Sample maximum' },
                ]}
              />
              <Notice tone="info" title="What this shows">
                <p>
                  Each trial draws a fresh sample and records the statistic. The spread of those values is the sampling distribution — how much the statistic
                  varies from one sample to the next. For the mean of a finite-variance distribution it becomes more normal and narrower as n grows.
                </p>
              </Notice>
            </Card>
          )}

          {config.modelId === 'project-schedule' && (
            <ProjectEditor config={config} set={set} />
          )}

          {config.modelId === 'markov-chain' && (
            <Card title="Chain settings">
              <MatrixEditor
                states={config.markov.states}
                matrix={config.markov.matrix}
                onChange={(states, matrix) => set({ markov: { ...config.markov, states, matrix, initialState: Math.min(config.markov.initialState, states.length - 1), targetState: Math.min(config.markov.targetState, states.length - 1) } })}
                issues={validateTransitionMatrix(config.markov.states, config.markov.matrix)}
              />
              <SelectField label="Starting state" value={String(config.markov.initialState)} onChange={(v) => set({ markov: { ...config.markov, initialState: Number(v) } })} options={config.markov.states.map((s, i) => ({ value: String(i), label: s }))} />
              <SelectField label="Target state (optional)" value={String(config.markov.targetState)} onChange={(v) => set({ markov: { ...config.markov, targetState: Number(v) } })} options={[{ value: '-1', label: 'None' }, ...config.markov.states.map((s, i) => ({ value: String(i), label: s }))]} hint="Records whether and when this state is first reached." />
              <NumberField label="Steps per trial" value={config.markov.steps} onChange={(steps) => set({ markov: { ...config.markov, steps } })} min={1} max={1000000} integer />
            </Card>
          )}

          {config.modelId === 'pi-estimation' && (
            <Card title="How this works" variant="inset">
              <p style={{ fontSize: 12.5, margin: 0 }}>
                Each trial drops a point at random into the unit square and records whether it lands inside the quarter circle of radius 1. The quarter circle
                has area π/4 and the square has area 1, so the share of points inside estimates π/4 — and four times that share estimates π. The exact value is
                known, which makes this a good way to see how Monte Carlo error behaves.
              </p>
            </Card>
          )}

          <SimulationSettingsCard settings={{ trials: config.trials, seed: config.seed, keepSamples: false }} onChange={(s) => set({ trials: s.trials, seed: s.seed })} />

          <RunPanel
            state={run.state}
            onRun={() => run.run({ modelId: config.modelId, config: modelConfig, trials: config.trials, seed: config.seed })}
            onCancel={run.cancel}
            disabled={issues.length > 0}
            fallbackReason={run.fallbackReason}
          />

          <AiAssistPanel capability="buildScenario" context="To model something not covered by these built-in models, use the Scenario Builder, where you define the variables and the output yourself." />
        </div>

        <div className="oc-stack">
          {issues.length > 0 && <Notice tone="error" title="This model is not configured correctly" items={issues.map((i) => i.message)} />}

          {!run.state.result && issues.length === 0 && (
            <Card>
              <Notice tone="info" title="Ready to run">
                <p>
                  {config.trials.toLocaleString('en-US')} trials will be simulated with seed <code>{config.seed}</code>. The run happens in a background thread,
                  so the interface stays responsive and you can cancel at any point.
                </p>
              </Notice>
            </Card>
          )}

          {run.state.result && <SimulationResults result={run.state.result} />}
        </div>
      </div>
    </>
  );
}

function ProjectEditor({ config, set }: { config: SimulationToolConfig; set(patch: Partial<SimulationToolConfig>): void }) {
  const project = config.project;
  const update = (patch: Partial<SimulationToolConfig['project']>) => set({ project: { ...project, ...patch } });
  const updateTask = (i: number, patch: Partial<(typeof project.tasks)[number]>) => update({ tasks: project.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  // Only distributions supported on non-negative values make sense for durations.
  const durationDistributions = DISTRIBUTIONS.filter((d) => d.kind === 'continuous' && d.support(defaultParams(d)).min >= 0);

  return (
    <Card title="Tasks" hint="Each task starts when all of its dependencies have finished.">
      {project.tasks.map((task, i) => {
        const def = getDistribution(task.distributionId);
        const paramIssues = validateParams(def, task.params);
        return (
          <Card key={task.id} variant="inset">
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextField label={`Task ${i + 1}`} value={task.name} onChange={(name) => updateTask(i, { name })} maxLength={80} />
              </div>
              {project.tasks.length > 1 && (
                <Button
                  icon="trash"
                  variant="ghost"
                  title={`Remove ${task.name}`}
                  onClick={() => update({ tasks: project.tasks.filter((_, j) => j !== i).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== task.id) })) })}
                />
              )}
            </div>
            <SelectField
              label="Duration distribution"
              value={task.distributionId}
              onChange={(distributionId) => updateTask(i, { distributionId, params: defaultParams(getDistribution(distributionId)) })}
              options={durationDistributions.map((d) => ({ value: d.id, label: d.name }))}
              hint={def.id === 'pert' || def.id === 'triangular' ? 'A three-point estimate: optimistic, most likely and pessimistic.' : def.description}
            />
            <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
              {def.params.map((spec) => (
                <div key={spec.key} style={{ flex: '1 1 90px', minWidth: 80 }}>
                  <NumberField
                    label={spec.label}
                    symbol={spec.symbol}
                    value={task.params[spec.key] ?? spec.defaultValue}
                    onChange={(v) => updateTask(i, { params: { ...task.params, [spec.key]: v } })}
                    error={paramIssues.find((p) => p.field === spec.key)?.message}
                  />
                </div>
              ))}
            </div>
            {paramIssues.filter((p) => !def.params.some((s) => s.key === p.field)).length > 0 && (
              <Notice tone="error" items={paramIssues.filter((p) => !def.params.some((s) => s.key === p.field)).map((p) => p.message)} />
            )}
            <div className="oc-field">
              <span className="oc-field__label">Starts after</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s1)' }}>
                {project.tasks
                  .filter((t) => t.id !== task.id)
                  .map((t) => {
                    const on = task.dependsOn.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        className="oc-btn oc-btn--sm"
                        style={on ? { background: 'var(--accent-dim)', borderColor: 'var(--accent)' } : undefined}
                        onClick={() => updateTask(i, { dependsOn: on ? task.dependsOn.filter((d) => d !== t.id) : [...task.dependsOn, t.id] })}
                      >
                        {on ? '✓ ' : ''}
                        {t.name}
                      </button>
                    );
                  })}
                {project.tasks.length === 1 && <span className="oc-muted" style={{ fontSize: 12 }}>Add another task to set dependencies.</span>}
              </div>
            </div>
          </Card>
        );
      })}
      <Button
        icon="plus"
        size="sm"
        disabled={project.tasks.length >= 40}
        onClick={() =>
          update({
            tasks: [...project.tasks, { id: `task-${Date.now().toString(36)}`, name: `Task ${project.tasks.length + 1}`, distributionId: 'pert', params: { a: 2, m: 4, b: 9 }, dependsOn: [] }],
          })
        }
      >
        Add a task
      </Button>
      <hr className="oc-divider" />
      <NumberField label="Deadline" value={project.deadline} onChange={(deadline) => update({ deadline })} min={0.0001} unit={project.unit} />
      <TextField label="Unit of time" value={project.unit} onChange={(unit) => update({ unit })} maxLength={20} />
      <Notice tone="warning" title="What this model leaves out">
        <p>
          Task durations are drawn independently. In reality delays often share a cause — one team, one supplier, one dependency — which makes the finish date
          more variable than this model shows. Resource limits, rework and queueing are not modelled either.
        </p>
      </Notice>
    </Card>
  );
}
