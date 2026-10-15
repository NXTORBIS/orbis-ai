/**
 * Markov chains: exact n-step behaviour, long-run distribution, chain
 * structure and absorption analysis, with optional path simulation.
 */
import { useMemo } from 'react';
import { absorptionAnalysis, classifyChain, nStepDistribution, nStepMatrix, stationaryDistribution } from '../../engine/stats/markov';
import { validateTransitionMatrix } from '../../engine/simulation/models';
import { Badge, Card, DataTable, Notice, NumberField, SelectField } from '../../ui/primitives';
import { formatPercent, formatValue, seriesColor } from '../../ui/charts/scale';
import { LineChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { AssumptionsPanel } from '../shared/ExplanationPanel';
import { RunPanel, SimulationSettingsCard, useSimulationRun } from '../shared/SimulationControls';
import { useApp } from '../store';
import { MatrixEditor } from './shared/MatrixEditor';
import { downloadText, toCsv } from '../../persistence/store';

export interface MarkovToolConfig {
  states: string[];
  matrix: number[][];
  initialState: number;
  steps: number;
  targetState: number;
  simulate: boolean;
  trials: number;
  seed: string;
}

export const MARKOV_DEFAULT: MarkovToolConfig = {
  states: ['Healthy', 'Degraded', 'Failed'],
  matrix: [
    [0.92, 0.07, 0.01],
    [0.25, 0.65, 0.1],
    [0, 0, 1],
  ],
  initialState: 0,
  steps: 30,
  targetState: 2,
  simulate: false,
  trials: 20000,
  seed: 'markov-1',
};

export function MarkovTool({ config }: { config: MarkovToolConfig }) {
  const app = useApp();
  const set = (patch: Partial<MarkovToolConfig>) => app.updateConfig({ ...config, ...patch });
  const run = useSimulationRun();

  const issues = useMemo(() => validateTransitionMatrix(config.states, config.matrix), [config.states, config.matrix]);

  const analysis = useMemo(() => {
    if (issues.length) return null;
    try {
      const initial = config.states.map((_, i) => (i === config.initialState ? 1 : 0));
      const classification = classifyChain(config.matrix);
      const stationary = stationaryDistribution(config.matrix);
      const atStep = nStepDistribution(config.matrix, initial, config.steps);
      const stepMatrix = nStepMatrix(config.matrix, config.steps);
      // Trajectory of the distribution for the first N steps.
      const maxPlot = Math.min(config.steps, 200);
      const trajectory: number[][] = [initial];
      for (let s = 1; s <= maxPlot; s++) trajectory.push(nStepDistribution(config.matrix, initial, s));
      let absorption = null;
      try {
        absorption = absorptionAnalysis(config.matrix);
      } catch {
        absorption = null;
      }
      return { classification, stationary, atStep, stepMatrix, trajectory, absorption };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [config.matrix, config.states, config.initialState, config.steps, issues]);

  const simulationConfig = useMemo(
    () => ({ states: config.states, matrix: config.matrix, initialState: config.initialState, steps: config.steps, targetState: config.targetState }),
    [config],
  );

  return (
    <>
      <ToolHeader toolId="markov" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="States and transitions">
            <MatrixEditor
              states={config.states}
              matrix={config.matrix}
              onChange={(states, matrix) =>
                set({
                  states,
                  matrix,
                  initialState: Math.min(config.initialState, states.length - 1),
                  targetState: config.targetState >= states.length ? -1 : config.targetState,
                })
              }
              issues={issues}
            />
          </Card>

          <Card title="Starting point and horizon">
            <SelectField label="Starting state" value={String(config.initialState)} onChange={(v) => set({ initialState: Number(v) })} options={config.states.map((s, i) => ({ value: String(i), label: s }))} />
            <NumberField label="Number of steps" value={config.steps} onChange={(steps) => set({ steps })} min={0} max={1000000} integer hint="The exact distribution after this many steps is computed by matrix multiplication, not simulation." />
            <SelectField
              label="State of particular interest"
              value={String(config.targetState)}
              onChange={(v) => set({ targetState: Number(v) })}
              options={[{ value: '-1', label: 'None' }, ...config.states.map((s, i) => ({ value: String(i), label: s }))]}
            />
          </Card>

          <Card title="Optional path simulation" hint="The analysis above is exact; simulation shows individual paths and first-passage times.">
            <SimulationSettingsCard settings={{ trials: config.trials, seed: config.seed, keepSamples: false }} onChange={(s) => set({ trials: s.trials, seed: s.seed })} />
            <RunPanel
              state={run.state}
              onRun={() => run.run({ modelId: 'markov-chain', config: simulationConfig, trials: config.trials, seed: config.seed })}
              onCancel={run.cancel}
              runLabel="Simulate paths"
              disabled={issues.length > 0}
              fallbackReason={run.fallbackReason}
            />
          </Card>

          <AiAssistPanel capability="interpretQuestion" context="Enter the states and the probability of moving between them; everything below follows from that matrix by linear algebra." />
        </div>

        <div className="oc-stack">
          {issues.length > 0 && <Notice tone="error" title="The transition matrix must be corrected first" items={issues.map((i) => i.message)} />}
          {analysis && 'error' in analysis && <Notice tone="error">{analysis.error}</Notice>}

          {analysis && !('error' in analysis) && (
            <>
              <Card title="Chain structure" actions={<Badge variant="exact">Exact</Badge>}>
                <Notice tone={analysis.classification.irreducible && analysis.classification.aperiodic ? 'success' : 'info'} title="Structure">
                  <p>{analysis.classification.note}</p>
                </Notice>
                <DataTable
                  caption="Communicating classes"
                  columns={[
                    { key: 's', header: 'States', render: (r) => (r as ClassRow).states.map((i) => config.states[i]).join(', ') },
                    { key: 't', header: 'Type', render: (r) => ((r as ClassRow).recurrent ? 'Recurrent — once entered, never left' : 'Transient — will eventually be left for good') },
                    { key: 'p', header: 'Period', numeric: true, render: (r) => ((r as ClassRow).period === null ? '—' : String((r as ClassRow).period)) },
                  ]}
                  rows={analysis.classification.classes as ClassRow[]}
                />
                {analysis.classification.absorbingStates.length > 0 && (
                  <p className="oc-chart-note">
                    Absorbing states (once reached, the chain stays there):{' '}
                    {analysis.classification.absorbingStates.map((i) => config.states[i]).join(', ')}.
                  </p>
                )}
              </Card>

              <Card title={`Distribution after ${config.steps} step(s)`} actions={<Badge variant="exact">Exact</Badge>}>
                <DataTable
                  caption={`Distribution after ${config.steps} steps`}
                  columns={[
                    { key: 's', header: 'State', render: (r) => (r as DistRow).state },
                    { key: 'p', header: `After ${config.steps} step(s)`, numeric: true, render: (r) => formatPercent((r as DistRow).probability, 5) },
                    { key: 'l', header: 'Long-run share', numeric: true, render: (r) => ((r as DistRow).stationary === null ? '—' : formatPercent((r as DistRow).stationary!, 5)) },
                    { key: 'r', header: 'Mean return time (steps)', numeric: true, title: 'Average number of steps between successive visits, in the long run', render: (r) => ((r as DistRow).recurrence === null ? '—' : formatValue((r as DistRow).recurrence!, 5)) },
                  ]}
                  rows={config.states.map((state, i) => ({
                    state,
                    probability: analysis.atStep[i],
                    stationary: analysis.stationary.distribution?.[i] ?? null,
                    recurrence: analysis.stationary.meanRecurrenceTimes[i],
                  }))}
                />
                <p className="oc-chart-note">
                  Computed as π₀Pⁿ by repeated matrix squaring — exact linear algebra, so these are the model's true probabilities rather than estimates.
                  {analysis.stationary.unique && analysis.classification.aperiodic
                    ? ' The long-run column is the unique stationary distribution the chain settles into from any starting point.'
                    : ''}
                </p>
              </Card>

              {analysis.trajectory.length > 2 && (
                <Card>
                  <LineChart
                    title="How the distribution evolves"
                    description="The exact probability of being in each state, step by step."
                    series={config.states.slice(0, 8).map((s, i) => ({ label: s, points: analysis.trajectory.map((d, step) => ({ x: step, y: d[i] })) }))}
                    xLabel="Steps taken"
                    yLabel="Probability of being in this state"
                    yDomain={[0, 1]}
                    valueFormatter={(v) => formatPercent(v)}
                    note={
                      analysis.stationary.distribution && analysis.classification.aperiodic
                        ? 'Flat curves mean the chain has reached its long-run distribution. Before that point, where it started still matters.'
                        : analysis.classification.aperiodic
                          ? undefined
                          : 'The curves oscillate rather than settling, because the chain is periodic: it returns to states on a fixed cycle.'
                    }
                    onExport={() =>
                      downloadText(
                        'markov-trajectory.csv',
                        toCsv(['step', ...config.states], analysis.trajectory.map((d, step) => [step, ...d])),
                      )
                    }
                  />
                  {config.states.length > 8 && <p className="oc-chart-note">Only the first 8 states are plotted; all of them appear in the table above and in the CSV export.</p>}
                </Card>
              )}

              {analysis.stationary.distribution && (
                <Card title="Long-run behaviour">
                  <div className="oc-stack--tight">
                    {config.states.map((s, i) => (
                      <div key={s}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 2 }}>
                          <span>{s}</span>
                          <span className="tnum">{formatPercent(analysis.stationary.distribution![i], 4)}</span>
                        </div>
                        <div style={{ height: 10, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${analysis.stationary.distribution![i] * 100}%`, height: '100%', background: seriesColor(i % 8), borderRadius: 4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="oc-chart-note">{analysis.stationary.method}</p>
                  {analysis.stationary.limitations.length > 0 && <Notice tone="warning" items={analysis.stationary.limitations} />}
                </Card>
              )}

              {analysis.absorption && analysis.absorption.transientStates.length > 0 && (
                <Card title="Time to absorption" actions={<Badge variant="exact">Exact</Badge>}>
                  <DataTable
                    caption="Expected steps to absorption and absorption probabilities"
                    columns={[
                      { key: 's', header: 'Starting from', render: (r) => config.states[(r as AbsRow).state] },
                      { key: 'e', header: 'Expected steps until absorbed', numeric: true, render: (r) => formatValue((r as AbsRow).steps, 5) },
                      ...analysis.absorption.absorbingStates.map((a, ai) => ({
                        key: `a${ai}`,
                        header: `Ends in ${config.states[a]}`,
                        numeric: true,
                        render: (r: unknown) => formatPercent((r as AbsRow).probabilities[ai], 4),
                      })),
                    ]}
                    rows={analysis.absorption.transientStates.map((state, ti) => ({
                      state,
                      steps: analysis.absorption!.expectedSteps[ti],
                      probabilities: analysis.absorption!.absorptionProbability[ti],
                    }))}
                  />
                  <p className="oc-chart-note">{analysis.absorption.method}</p>
                  <Notice tone="info" title="Reading an expected time">
                    <p>
                      Starting from {config.states[analysis.absorption.transientStates[0]]}, absorption takes{' '}
                      {formatValue(analysis.absorption.expectedSteps[0], 4)} steps on average. Individual paths vary widely around that average, and the
                      distribution of absorption times is usually skewed — the simulation below shows its shape.
                    </p>
                  </Notice>
                  <AssumptionsPanel assumptions={[]} limitations={analysis.absorption.limitations} title="Limitations of these figures" />
                </Card>
              )}

              {run.state.result && (
                <Card title="Simulated paths">
                  {(() => {
                    const result = run.state.result!;
                    const reached = result.outputs.find((o) => o.spec.key === 'reachedTarget');
                    const passage = result.outputs.find((o) => o.spec.key === 'firstPassage');
                    const fractions = config.states.map((s, i) => ({ state: s, out: result.outputs.find((o) => o.spec.key === `fraction:${i}`) }));
                    return (
                      <>
                        <DataTable
                          caption="Simulated time in each state against the exact long-run share"
                          columns={[
                            { key: 's', header: 'State', render: (r) => (r as SimRow).state },
                            { key: 'o', header: 'Simulated share of steps', numeric: true, render: (r) => ((r as SimRow).observed === null ? '—' : formatPercent((r as SimRow).observed!, 4)) },
                            { key: 'e', header: 'Exact long-run share', numeric: true, render: (r) => ((r as SimRow).expected === null ? '—' : formatPercent((r as SimRow).expected!, 4)) },
                          ]}
                          rows={fractions.map((f, i) => ({
                            state: f.state,
                            observed: f.out?.summary.mean ?? null,
                            expected: analysis.stationary.distribution?.[i] ?? null,
                          }))}
                        />
                        {reached && (
                          <div className="oc-figure-grid" style={{ marginTop: 'var(--s4)' }}>
                            <div className="oc-figure">
                              <span className="oc-figure__label">Reached {config.states[config.targetState]} within {config.steps} steps</span>
                              <div className="oc-figure__value">{formatPercent(reached.summary.mean, 4)}</div>
                              <div className="oc-figure__sub">
                                95% interval {formatPercent(reached.estimateInterval.low, 3)} – {formatPercent(reached.estimateInterval.high, 3)}
                              </div>
                            </div>
                            {passage && Number.isFinite(passage.summary.mean) && (
                              <div className="oc-figure">
                                <span className="oc-figure__label">Average steps to first reach it (when reached)</span>
                                <div className="oc-figure__value">{formatValue(passage.summary.mean, 5)}</div>
                                <div className="oc-figure__sub">Median {formatValue(passage.summary.median, 4)}; paths that never reached it are excluded</div>
                              </div>
                            )}
                          </div>
                        )}
                        {passage && passage.nonFinite > 0 && (
                          <Notice tone="info" title="Paths that never reached the target">
                            <p>
                              {passage.nonFinite.toLocaleString('en-US')} of {result.trialsCompleted.toLocaleString('en-US')} simulated paths did not reach{' '}
                              {config.states[config.targetState]} within {config.steps} steps. They are excluded from the average above, which is therefore the
                              average <em>given that it was reached</em> — a conditional figure, not the overall expected time.
                            </p>
                          </Notice>
                        )}
                        <p className="oc-chart-note">
                          Simulated shares differ from the exact long-run values by sampling error, and because each path runs for only {config.steps} steps
                          starting from {config.states[config.initialState]} rather than for ever.
                        </p>
                      </>
                    );
                  })()}
                </Card>
              )}

              <AssumptionsPanel
                assumptions={[
                  'The Markov property: where the chain goes next depends only on where it is now, not on how it got there.',
                  'The transition probabilities are constant over time.',
                  'The state set is complete: every possibility is one of the listed states.',
                ]}
                limitations={[
                  'Real processes often have memory — a system that has been degraded for a long time may behave differently from one that just became degraded. A Markov chain cannot represent that unless the history is built into the states.',
                  'The transition probabilities are inputs. If they were estimated from limited data, they carry uncertainty that this exact analysis does not propagate.',
                ]}
                title="What a Markov chain assumes"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface ClassRow {
  states: number[];
  recurrent: boolean;
  period: number | null;
}
interface DistRow {
  state: string;
  probability: number;
  stationary: number | null;
  recurrence: number | null;
}
interface AbsRow {
  state: number;
  steps: number;
  probabilities: number[];
}
interface SimRow {
  state: string;
  observed: number | null;
  expected: number | null;
}
