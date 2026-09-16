import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleStop, Dot, LoaderCircle, Pause, Play, Plus, Radio, Search, Settings2, Square } from 'lucide-react'
import type { ActiveWorkflowRun, Workflow, WorkflowLibrary } from '../../../shared/workflows'
import type { NoticeKind } from '../App'
import { RunDialog } from './WorkflowRunPanel'

const EMPTY: WorkflowLibrary = { workflows: [], stats: {}, nextRuns: {}, active: [], checkpoints: [], recording: { active: false, paused: false, steps: [], inputs: [], startedAt: 0 }, canRememberSecrets: false }

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  paused: 'Paused',
  'waiting-user': 'Waiting for you',
  'waiting-confirm': 'Needs approval',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped'
}

/**
 * The Workflows button's panel, next to the address bar: the workflows you can run on the page you are on, whatever is
 * running right now, and a way to record a new one — without leaving the page. Everything else lives in the full
 * Workflows screen.
 */
export default function WorkflowQuickPanel({ url, onOpenLibrary, onClose, onNotify }: { url: string; onOpenLibrary(): void; onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [library, setLibrary] = useState<WorkflowLibrary>(EMPTY)
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState<Workflow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => void window.api.getWorkflowLibrary().then(setLibrary)
  useEffect(() => {
    refresh()
    searchRef.current?.focus()
    const offs = [window.api.onWorkflowsChanged(refresh), window.api.onWorkflowRunUpdate(refresh), window.api.onWorkflowRunFinished(refresh), window.api.onWorkflowRecording(refresh)]
    return () => offs.forEach((off) => off())
  }, [])

  const host = useMemo(() => {
    try {
      return url ? new URL(url).host.replace(/^www\./, '') : ''
    } catch {
      return ''
    }
  }, [url])

  /** Workflows that mention this site come first: those are the ones you probably want here. */
  const runnable = useMemo(() => {
    const q = query.trim().toLowerCase()
    const forSite = (w: Workflow): boolean => Boolean(host) && JSON.stringify(w.steps).toLowerCase().includes(host)
    return library.workflows
      .filter((w) => w.status !== 'archived' && !w.template)
      .filter((w) => !q || `${w.name} ${w.description ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(forSite(b)) - Number(forSite(a)) || Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((w) => ({ workflow: w, forSite: forSite(w) }))
  }, [library.workflows, query, host])

  const start = async (workflow: Workflow): Promise<void> => {
    if (workflow.inputs.length) return setAsking(workflow)
    setBusy(workflow.id)
    const result = await window.api.runWorkflow(workflow.id)
    setBusy(null)
    if (result.ok) onNotify(`“${workflow.name}” started`)
    else onNotify(result.message, 'error')
  }

  const control = (run: ActiveWorkflowRun, action: 'pause' | 'resume' | 'stop'): void => void window.api.controlWorkflowRun(run.runId, action)

  const stopAndSave = async (): Promise<void> => {
    const suggested = `${host || 'Recording'} ${new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    const saved = await window.api.saveWorkflowRecording(suggested)
    onNotify(`Saved “${saved.name}” with ${saved.steps.length} step${saved.steps.length === 1 ? '' : 's'} — rename it in Workflows`)
  }

  if (asking) {
    return (
      <div className="wf-quick popover glass" role="dialog" aria-label={`Run ${asking.name}`}>
        <RunDialog
          workflow={asking}
          debug={false}
          canRememberSecrets={library.canRememberSecrets}
          onCancel={() => setAsking(null)}
          onStarted={(run) => {
            setAsking(null)
            onNotify(`“${run.workflowName}” started`)
          }}
        />
      </div>
    )
  }

  return (
    <div className="wf-quick popover glass" role="dialog" aria-label="Workflows">
      <header className="wf-quick-head">
        <label className="wf-quick-search">
          <Search size={13} aria-hidden="true" />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={host ? `Workflows for ${host}` : 'Search workflows'} aria-label="Search workflows" />
        </label>
        <button type="button" className="wf-quick-icon" title="All workflows" aria-label="All workflows" onClick={() => (onClose(), onOpenLibrary())}>
          <Settings2 size={14} />
        </button>
      </header>

      {library.active.length > 0 && (
        <section className="wf-quick-section" aria-label="Running now">
          {library.active.map((run) => (
            <div key={run.runId} className="wf-quick-run">
              <span className={`wf-status ${run.state.status}`}>
                {run.state.status === 'running' && <LoaderCircle size={11} className="spin" aria-hidden="true" />}
                {STATUS_LABEL[run.state.status] ?? run.state.status}
              </span>
              <b>{run.workflowName}</b>
              <small className="wf-muted">
                {run.state.stepIndex ?? 0}/{run.state.stepCount ?? 0}
              </small>
              <span className="wf-quick-run-actions">
                {run.state.status === 'running' ? (
                  <button type="button" className="wf-quick-icon" title="Pause" aria-label={`Pause ${run.workflowName}`} onClick={() => control(run, 'pause')}>
                    <Pause size={13} />
                  </button>
                ) : (
                  <button type="button" className="wf-quick-icon" title="Resume" aria-label={`Resume ${run.workflowName}`} onClick={() => control(run, 'resume')}>
                    <Play size={13} />
                  </button>
                )}
                <button type="button" className="wf-quick-icon danger" title="Stop" aria-label={`Stop ${run.workflowName}`} onClick={() => control(run, 'stop')}>
                  <CircleStop size={13} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="wf-quick-section" aria-label="Workflows">
        {runnable.map(({ workflow, forSite }) => (
          <button key={workflow.id} type="button" className="wf-quick-item" disabled={busy === workflow.id} onClick={() => void start(workflow)}>
            <span className="wf-quick-item-main">
              <b>{workflow.name}</b>
              {workflow.description && <small className="wf-muted">{workflow.description}</small>}
            </span>
            {forSite && (
              <small className="wf-quick-tag" title={`Uses ${host}`}>
                <Dot size={12} aria-hidden="true" />
                {host}
              </small>
            )}
            {busy === workflow.id ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          </button>
        ))}
        {!runnable.length && <p className="wf-muted wf-quick-empty">{query ? 'No workflow matches.' : 'No workflows yet. Record one to get started.'}</p>}
      </section>

      <footer className="wf-quick-foot">
        {library.recording.active ? (
          <>
            <span className="wf-quick-recording">
              <Radio size={13} aria-hidden="true" /> Recording · {library.recording.steps.length} step{library.recording.steps.length === 1 ? '' : 's'}
            </span>
            <button type="button" className="wf-quick-btn" onClick={() => void window.api.pauseWorkflowRecording(!library.recording.paused)}>
              {library.recording.paused ? 'Continue' : 'Pause'}
            </button>
            <button type="button" className="wf-quick-btn" onClick={() => void window.api.stopWorkflowRecording().then(() => onNotify('Recording discarded'))}>
              Discard
            </button>
            <button type="button" className="wf-quick-btn primary" disabled={!library.recording.steps.length} onClick={() => void stopAndSave()}>
              <Square size={12} aria-hidden="true" /> Stop & save
            </button>
          </>
        ) : (
          <>
            <button type="button" className="wf-quick-btn" onClick={() => void window.api.startWorkflowRecording().then(() => onNotify('Recording what you do'))}>
              <Radio size={12} aria-hidden="true" /> Record
            </button>
            <button type="button" className="wf-quick-btn" onClick={() => (onClose(), onOpenLibrary())}>
              <Plus size={12} aria-hidden="true" /> New
            </button>
            <button type="button" className="wf-quick-btn ghost" onClick={() => (onClose(), onOpenLibrary())}>
              All workflows
            </button>
          </>
        )}
      </footer>
    </div>
  )
}
