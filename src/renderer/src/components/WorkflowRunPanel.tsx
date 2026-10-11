import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CircleStop, KeyRound, LoaderCircle, Pause, Play, RotateCcw, SkipForward, StepForward, X } from 'lucide-react'
import { Modal } from '../ui'
import type { RunControl, StepRecord } from '../../../shared/browserControl'
import type { ActiveWorkflowRun, Workflow, WorkflowIssue, WorkflowRunSummary } from '../../../shared/workflows'

const STATUS: Record<string, string> = {
  running: 'Running',
  paused: 'Paused',
  'waiting-confirmation': 'Waiting for your approval',
  'waiting-user': 'Waiting for you',
  stopping: 'Stopping…',
  stopped: 'Stopped',
  completed: 'Completed',
  failed: 'Failed'
}

const formatDuration = (ms: number): string => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`)

/** What to try after a failure, from how it actually failed. */
export function failureAdvice(code: string | undefined): string {
  switch (code) {
    case 'not-found':
    case 'stale-element':
      return 'The element or page wasn’t there. The site may have changed: check the step’s locator, add a wait before it, or re-record the step.'
    case 'timeout':
      return 'It took too long. Add a wait for the page before this step, or give the step a longer timeout.'
    case 'verification-failed':
      return 'The action ran but the expected result didn’t appear. Check what the step expects, or whether the page needs more time.'
    case 'declined':
      return 'You declined an approval, so the run stopped there.'
    case 'blocked':
      return 'Orbis refused this action (for example, typing a password) or another automation was using the same tab.'
    case 'unavailable':
      return 'What the step needs wasn’t available (for example, the browser was closed). Open it and run again.'
    case 'invalid-params':
      return 'A step’s settings aren’t valid. Open the step and fix the highlighted values.'
    default:
      return 'Open the failed step to see what happened, then edit it and run again.'
  }
}

function RecordList({ records }: { records: StepRecord[] }): React.JSX.Element {
  if (!records.length) return <p className="wf-muted">No steps have run yet.</p>
  return (
    <ol className="wf-records">
      {records.map((r, i) => (
        <li key={`${r.path}-${r.startedAt}-${i}`} className={`wf-record ${r.status}`}>
          <span className="wf-record-icon" aria-hidden="true">
            {r.status === 'success' ? <Check size={12} /> : r.status === 'failed' ? <X size={12} /> : r.status === 'skipped' ? <SkipForward size={12} /> : <CircleStop size={12} />}
          </span>
          <span className="wf-record-main">
            <b>{r.label ?? r.action ?? r.kind}</b>
            <small>
              {r.action ? `${r.action} · ` : ''}
              {r.status}
              {r.iteration ? ` · iteration ${r.iteration}` : ''}
              {` · ${formatDuration(r.durationMs)}`}
              {r.attempts && r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}
            </small>
            {r.verification && <small className={r.verification.verified ? 'wf-ok' : 'wf-bad'}>{r.verification.detail}</small>}
            {r.error && <small className="wf-bad">{r.error.message}</small>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** A run in progress: its state, what it's waiting for, its variables and steps, and every control over it. */
export function LiveRun({ run, records }: { run: ActiveWorkflowRun; records: StepRecord[] }): React.JSX.Element {
  const s = run.state
  const control = (action: RunControl): void => void window.api.controlWorkflowRun(run.runId, action)
  const paused = s.status === 'paused' || s.status === 'waiting-user'
  return (
    <section className="wf-panel" aria-label="Run">
      <header className="wf-panel-head">
        <span className={`wf-status ${s.status}`}>
          {s.status === 'running' && <LoaderCircle size={12} className="spin" />}
          {STATUS[s.status] ?? s.status}
        </span>
        <small className="wf-muted">
          {s.stepIndex ?? 0}/{s.stepCount ?? 0} steps
          {s.iteration ? ` · iteration ${s.iteration}${s.totalIterations ? `/${s.totalIterations}` : ''}` : ''}
          {` · ${formatDuration(Date.now() - s.startedAt)}`}
        </small>
      </header>
      {s.currentStep && (
        <p className="wf-current">
          <b>Now:</b> {s.currentStep}
          {s.currentAction ? ` (${s.currentAction})` : ''}
        </p>
      )}
      {s.waitingFor && (
        <div className={`wf-waiting ${s.waitingFor.kind}`} role="status">
          {s.waitingFor.kind === 'debugger' ? <StepForward size={14} /> : <AlertTriangle size={14} />}
          <span>{s.waitingFor.message}</span>
        </div>
      )}
      {s.error && s.status === 'paused' && <p className="wf-bad">{failureAdvice(s.error.code)}</p>}
      <div className="wf-controls">
        {paused ? (
          <button type="button" className="queue-btn primary" onClick={() => control('resume')}>
            <Play size={11} /> {s.waitingFor?.kind === 'user' ? 'Continue' : 'Resume'}
          </button>
        ) : (
          <button type="button" className="queue-btn" onClick={() => control('pause')} disabled={s.status !== 'running'}>
            <Pause size={11} /> Pause
          </button>
        )}
        {run.debug && (
          <button type="button" className="queue-btn" onClick={() => control('step')} disabled={!paused}>
            <StepForward size={11} /> Step
          </button>
        )}
        <button type="button" className="queue-btn" onClick={() => control('skip')} disabled={s.status !== 'running'} title="Skip the step that is running now">
          <SkipForward size={11} /> Skip step
        </button>
        <button type="button" className="queue-btn" onClick={() => control('restart-step')} disabled={s.status !== 'running'} title="Start the running step again">
          <RotateCcw size={11} /> Restart step
        </button>
        {s.iteration !== undefined && (
          <button type="button" className="queue-btn" onClick={() => control('stop-after-iteration')}>
            Stop after this iteration
          </button>
        )}
        <button type="button" className="queue-btn danger" onClick={() => control('stop')}>
          <CircleStop size={11} /> Stop
        </button>
      </div>
      <details className="wf-details" open={Object.keys(s.variables).length > 0 && Object.keys(s.variables).length < 12}>
        <summary>Variables ({Object.keys(s.variables).length})</summary>
        {Object.keys(s.variables).length ? (
          <dl className="wf-vars">
            {Object.entries(s.variables).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="wf-muted">No variables yet.</p>
        )}
      </details>
      <RecordList records={records} />
    </section>
  )
}

/** A finished run from history, with a failure analysis based on what actually happened. */
export function RunSummaryView({ summary }: { summary: WorkflowRunSummary }): React.JSX.Element {
  const failed = summary.steps.filter((r) => r.status === 'failed').at(-1)
  return (
    <section className="wf-panel" aria-label="Run details">
      <header className="wf-panel-head">
        <span className={`wf-status ${summary.status}`}>{STATUS[summary.status] ?? summary.status}</span>
        <small className="wf-muted">
          {new Date(summary.startedAt).toLocaleString()} · {formatDuration(summary.durationMs)} · {summary.stepsRun} steps
          {summary.iterations ? ` · ${summary.iterations} iterations` : ''} · {summary.trigger}
        </small>
      </header>
      {summary.error && (
        <div className="wf-analysis" role="note">
          <b>Failure analysis</b>
          <p>
            <span className="wf-muted">Step:</span> {summary.error.stepLabel ?? summary.error.stepPath ?? 'unknown'}
          </p>
          <p>
            <span className="wf-muted">Problem:</span> {summary.error.message}
          </p>
          {failed?.attempts && failed.attempts > 1 && (
            <p>
              <span className="wf-muted">Attempts:</span> {failed.attempts}
            </p>
          )}
          <p>
            <span className="wf-muted">What to try:</span> {failureAdvice(summary.error.code)}
          </p>
        </div>
      )}
      {summary.outputs && Object.keys(summary.outputs).length > 0 && (
        <dl className="wf-vars">
          {Object.entries(summary.outputs).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <RecordList records={summary.steps} />
    </section>
  )
}

/** Asks for a workflow's inputs (secret ones can be remembered on this computer), then starts the run. */
export function RunDialog({
  workflow,
  debug,
  canRememberSecrets,
  onCancel,
  onStarted
}: {
  workflow: Workflow
  debug: boolean
  canRememberSecrets: boolean
  onCancel(): void
  onStarted(run: ActiveWorkflowRun): void
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(workflow.inputs.map((i) => [i.name, i.default === undefined || i.type === 'secret' ? '' : String(i.default)])))
  const [remember, setRemember] = useState<Record<string, boolean>>({})
  const [remembered, setRemembered] = useState<string[]>([])
  const [problem, setProblem] = useState<{ message: string; issues: WorkflowIssue[] } | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void window.api.rememberedWorkflowSecrets(workflow.id).then(setRemembered)
  }, [workflow.id])

  const start = async (): Promise<void> => {
    setStarting(true)
    setProblem(null)
    try {
      for (const input of workflow.inputs) {
        if (input.type === 'secret' && remember[input.name] && values[input.name]) await window.api.rememberWorkflowSecret(workflow.id, input.name, values[input.name])
      }
      const inputs = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''))
      const result = await window.api.runWorkflow(workflow.id, { inputs, debug })
      if (result.ok) onStarted(result.run)
      else setProblem({ message: result.message, issues: result.issues })
    } catch (err) {
      setProblem({ message: err instanceof Error ? err.message : String(err), issues: [] })
    } finally {
      setStarting(false)
    }
  }

  // Escape was handled on the form itself, which only hears the key once something inside it already has focus,
  // and it stopped the key there so the shell would not close the panel behind this dialog as well. The shared
  // dialog listens at the window and holds focus inside, so the key works whatever you were doing and still does
  // not reach what is behind. A click outside must not close it: this holds words somebody has typed, secrets
  // among them. Still a form rather than a question, so it stays `role="dialog"`.
  return (
    <Modal
      label={`Run ${workflow.name}`}
      onClose={onCancel}
      outsideCloses={false}
      cover="ext-prompt-backdrop control-prompt-backdrop"
      panel="popover glass ext-prompt wf-run-dialog"
    >
      {/* The form stays, so Enter in a field starts the run and the submit button still submits. It takes no space
          of its own, which leaves its children direct children of the panel -- the panel is the flex column that
          spaces them, and a box between the two would collapse that spacing. */}
      <form
        style={{ display: 'contents' }}
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <div className="ext-prompt-head">
          <span className="wf-icon" style={{ background: workflow.color }} aria-hidden="true">
            {workflow.icon}
          </span>
          <h3>
            {debug ? 'Debug' : 'Run'} “{workflow.name}”
          </h3>
        </div>
        {workflow.inputs.length === 0 && <p>This workflow has no inputs.</p>}
        {workflow.inputs.map((input) => (
          <label key={input.name} className="wf-field">
            <span>
              {input.label || input.name}
              {input.required && ' *'}
              {input.type === 'secret' && <KeyRound size={11} aria-label="private" />}
            </span>
            <input
              className="hud-input compact"
              type={input.type === 'secret' ? 'password' : input.type === 'number' ? 'number' : input.type === 'url' ? 'url' : 'text'}
              value={values[input.name] ?? ''}
              autoComplete="off"
              placeholder={input.type === 'secret' && remembered.includes(input.name) ? 'Saved on this computer (leave empty to use it)' : (input.description ?? '')}
              onChange={(e) => setValues((v) => ({ ...v, [input.name]: e.target.value }))}
            />
            {input.type === 'secret' && canRememberSecrets && (
              <span className="wf-inline">
                <label>
                  <input type="checkbox" checked={remember[input.name] === true} onChange={(e) => setRemember((r) => ({ ...r, [input.name]: e.target.checked }))} /> Remember on this computer (encrypted)
                </label>
                {remembered.includes(input.name) && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => void window.api.forgetWorkflowSecret(workflow.id, input.name).then(() => setRemembered((list) => list.filter((n) => n !== input.name)))}
                  >
                    Forget saved value
                  </button>
                )}
              </span>
            )}
          </label>
        ))}
        {problem && (
          <div className="wf-analysis" role="alert">
            <b>It can’t run yet</b>
            {problem.issues.length ? (
              <ul>
                {problem.issues.map((issue, i) => (
                  <li key={i}>{issue.path ? `Step ${issue.path}: ${issue.message}` : issue.message}</li>
                ))}
              </ul>
            ) : (
              <p>{problem.message}</p>
            )}
          </div>
        )}
        <div className="ext-prompt-actions">
          <button type="button" className="tab-edit-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="tab-edit-btn primary" disabled={starting} autoFocus={workflow.inputs.length === 0}>
            {starting ? 'Starting…' : debug ? 'Start debugging' : 'Run'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
