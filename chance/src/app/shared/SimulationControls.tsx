/**
 * Shared simulation controls and the hook that runs a simulation through the
 * worker with real progress and cancellation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineError, type Issue } from '../../engine/core/result';
import { SIMULATION_LIMITS, type SimulationRequest, type SimulationResult } from '../../engine/simulation/types';
import { randomSeed } from '../../engine/random/rng';
import { getSimulationClient, type JobHandle } from '../../workers/client';
import { Button, Card, Field, Notice, NumberField, RunningState, useToast } from '../../ui/primitives';
import { Icon } from '../../ui/icons';

export interface SimulationSettings {
  trials: number;
  seed: string;
  keepSamples: boolean;
}

export function SimulationSettingsCard({
  settings,
  onChange,
  maxTrials = SIMULATION_LIMITS.maxTrials,
  trialLabel = 'trials',
  note,
}: {
  settings: SimulationSettings;
  onChange(next: SimulationSettings): void;
  maxTrials?: number;
  trialLabel?: string;
  note?: string;
}) {
  return (
    <Card title="Simulation settings" hint="The seed makes a run exactly reproducible.">
      <NumberField
        label={`Number of ${trialLabel}`}
        value={settings.trials}
        onChange={(trials) => onChange({ ...settings, trials })}
        min={1}
        max={maxTrials}
        integer
        hint={`Up to ${maxTrials.toLocaleString('en-US')}. More ${trialLabel} reduce sampling error roughly in proportion to 1/√n, so four times as many halves the error.`}
      />
      <Field label="Random seed" hint="Running again with the same seed and the same settings reproduces identical results.">
        {({ id, describedBy }) => (
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            <input
              id={id}
              className="oc-input"
              style={{ fontFamily: 'var(--font-mono)' }}
              value={settings.seed}
              aria-describedby={describedBy}
              maxLength={64}
              onChange={(e) => onChange({ ...settings, seed: e.target.value })}
            />
            <Button icon="shuffle" title="Generate a new random seed" onClick={() => onChange({ ...settings, seed: randomSeed() })} />
          </div>
        )}
      </Field>
      {note && <p className="oc-field__hint" style={{ marginTop: 'calc(-1 * var(--s2))' }}>{note}</p>}
    </Card>
  );
}

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  completed: number;
  total: number;
  result: SimulationResult | null;
  issues: Issue[];
}

const IDLE: RunState = { status: 'idle', completed: 0, total: 0, result: null, issues: [] };

/**
 * Runs simulations through the worker. Progress values come from the runner,
 * so the progress bar always reflects completed trials.
 */
export function useSimulationRun() {
  const [state, setState] = useState<RunState>(IDLE);
  const jobRef = useRef<JobHandle<SimulationResult> | null>(null);
  const client = getSimulationClient();
  const toast = useToast();

  useEffect(
    () => () => {
      jobRef.current?.cancel();
    },
    [],
  );

  const run = useCallback(
    (request: SimulationRequest) => {
      const issues = client.validate(request);
      if (issues.length) {
        setState({ ...IDLE, status: 'error', issues });
        return;
      }
      jobRef.current?.cancel();
      setState({ status: 'running', completed: 0, total: request.trials, result: null, issues: [] });
      const job = client.run(request, {
        onProgress: (completed, total) => setState((s) => (s.status === 'running' ? { ...s, completed, total } : s)),
      });
      jobRef.current = job;
      void job.promise
        .then((result) => {
          setState({
            status: result.cancelled ? 'cancelled' : 'done',
            completed: result.trialsCompleted,
            total: request.trials,
            result,
            issues: [],
          });
        })
        .catch((e: unknown) => {
          const issues = e instanceof EngineError ? e.issues : [{ code: 'unexpected', message: e instanceof Error ? e.message : String(e) }];
          setState({ ...IDLE, status: 'error', issues });
          toast.push('error', issues[0]?.message ?? 'The simulation failed.');
        })
        .finally(() => {
          jobRef.current = null;
        });
    },
    [client, toast],
  );

  const cancel = useCallback(() => {
    jobRef.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    jobRef.current?.cancel();
    setState(IDLE);
  }, []);

  return { state, run, cancel, reset, usesWorker: client.usesWorker, fallbackReason: client.fallbackReason };
}

export function RunPanel({
  state,
  onRun,
  onCancel,
  runLabel = 'Run simulation',
  unitLabel = 'trials',
  disabled,
  fallbackReason,
}: {
  state: RunState;
  onRun(): void;
  onCancel(): void;
  runLabel?: string;
  unitLabel?: string;
  disabled?: boolean;
  fallbackReason?: string | null;
}) {
  return (
    <div className="oc-stack--tight">
      {fallbackReason && <Notice tone="warning">{fallbackReason}</Notice>}
      {state.status === 'running' ? (
        <RunningState completed={state.completed} total={state.total} unitLabel={unitLabel} onCancel={onCancel} />
      ) : (
        <Button variant="primary" icon="play" block onClick={onRun} disabled={disabled}>
          {runLabel}
        </Button>
      )}
      {state.status === 'error' && state.issues.length > 0 && (
        <Notice tone="error" title="This run could not start">
          <ul>
            {state.issues.map((i, idx) => (
              <li key={idx}>{i.message}</li>
            ))}
          </ul>
        </Notice>
      )}
      {state.status === 'cancelled' && state.result && (
        <Notice tone="warning" title="Run cancelled">
          <p>
            {state.result.trialsCompleted.toLocaleString('en-US')} of {state.result.trialsRequested.toLocaleString('en-US')} {unitLabel} were completed. The
            results below use only the completed {unitLabel}, so they are less precise than a full run.
          </p>
        </Notice>
      )}
    </div>
  );
}

/** Small banner summarising how a result was produced. */
export function RunProvenance({ result }: { result: SimulationResult }) {
  return (
    <p className="oc-chart-note" style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <Icon name="info" size={12} />
      <span>
        {result.trialsCompleted.toLocaleString('en-US')} {result.trialsCompleted === 1 ? 'trial' : 'trials'} · seed <code>{result.seed}</code> · {result.durationMs.toLocaleString('en-US')} ms ·
        re-running with this seed and these settings reproduces these numbers exactly.
      </span>
    </p>
  );
}
