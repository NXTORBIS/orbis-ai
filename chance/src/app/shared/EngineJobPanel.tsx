/**
 * Shared progress / cancel / error panel for a screen running an engine job
 * through `useEngineJob`. It displays values the job reported and nothing
 * else: the bar is driven by completed iterations, the phase label comes from
 * the job, and a refusal is shown with the engine's own message.
 *
 * The live progress is read from the job's progress store rather than from
 * React state, so a moving bar re-renders this panel alone and not the whole
 * tool screen around it.
 */
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Button, Notice, RunningState } from '../../ui/primitives';
import type { EngineJobId } from '../../engine/jobs/registry';
import type { EngineJobApi } from './useEngineJob';

function JobProgressBar({ job, unitLabel }: { job: EngineJobApi<EngineJobId>; unitLabel: string }) {
  const progress = useSyncExternalStore(job.progress.subscribe, job.progress.get, job.progress.get);
  return (
    <>
      <RunningState completed={progress.completed} total={progress.total} unitLabel={unitLabel} onCancel={job.cancel} />
      {progress.label && <p className="oc-chart-note">{progress.label}</p>}
    </>
  );
}

export function EngineJobPanel<K extends EngineJobId>({
  job,
  onClear,
  unitLabel,
  clearLabel = 'Clear',
  errorTitle = 'This computation could not be completed',
  children,
  testId,
}: {
  job: EngineJobApi<K>;
  onClear?(): void;
  unitLabel: string;
  clearLabel?: string;
  errorTitle?: string;
  /** Rendered only once a result is available. */
  children?: ReactNode;
  testId?: string;
}) {
  const { status } = job.state;
  return (
    <div className="oc-stack--tight" data-testid={testId}>
      {status === 'running' && job.fallbackReason && <Notice tone="warning">{job.fallbackReason}</Notice>}
      {status === 'running' && (
        <div data-testid={testId ? `${testId}-running` : undefined}>
          <JobProgressBar job={job as unknown as EngineJobApi<EngineJobId>} unitLabel={unitLabel} />
        </div>
      )}
      {status === 'cancelled' && (
        <>
          <Notice tone="warning" title="Cancelled before it finished">
            <p style={{ margin: 0 }}>
              The computation was stopped before it finished, and no result is shown. An unfinished fit is not a less precise version of the finished one, so
              there is no number here that would mean anything.
            </p>
          </Notice>
          {onClear && (
            <div className="oc-btn-row">
              <Button icon="reset" onClick={onClear}>
                {clearLabel}
              </Button>
            </div>
          )}
        </>
      )}
      {status === 'error' && (
        <>
          <Notice tone="error" title={errorTitle} items={job.state.issues.map((i) => i.message)} />
          {onClear && (
            <div className="oc-btn-row">
              <Button icon="reset" onClick={onClear}>
                {clearLabel}
              </Button>
            </div>
          )}
        </>
      )}
      {status === 'done' && children}
    </div>
  );
}
