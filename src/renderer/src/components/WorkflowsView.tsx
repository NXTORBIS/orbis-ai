import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  CircleStop,
  Copy,
  Download,
  LoaderCircle,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Radio,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
  X
} from 'lucide-react'
import type { StepRecord } from '../../../shared/browserControl'
import type { ActiveWorkflowRun, Workflow, WorkflowLibrary } from '../../../shared/workflows'
import type { NoticeKind } from '../App'
import { countSteps } from '../lib/workflowSteps'
import WorkflowEditor from './WorkflowEditor'
import { RunDialog } from './WorkflowRunPanel'

interface Props {
  onClose(): void
  onNotify(text: string, kind?: NoticeKind): void
}

type Filter = 'all' | 'favorites' | 'recent' | 'failed' | 'scheduled' | 'templates' | 'archived'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
  { id: 'failed', label: 'Failed' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'templates', label: 'Templates' },
  { id: 'archived', label: 'Archived' }
]

const ago = (time: number): string => {
  const s = Math.round((Date.now() - time) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return new Date(time).toLocaleDateString()
}

/**
 * The Workflow Library: every saved workflow with its real run statistics, schedules and state, and everything you can
 * do with one (run, edit, duplicate, export, favorite, pin, archive, delete); new workflows by hand, by recording, from
 * Orion or by import; interrupted runs to resume; runs in progress.
 */
export default function WorkflowsView({ onClose, onNotify }: Props): React.JSX.Element {
  const [library, setLibrary] = useState<WorkflowLibrary | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, ActiveWorkflowRun>>({})
  const [records, setRecords] = useState<Record<string, StepRecord[]>>({})
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [recordName, setRecordName] = useState('')
  const [runRequest, setRunRequest] = useState<{ workflow: Workflow; debug: boolean } | null>(null)

  const refresh = useCallback(() => {
    void window.api.getWorkflowLibrary().then((lib) => {
      setLibrary(lib)
      setRuns((current) => ({ ...Object.fromEntries(lib.active.map((r) => [r.runId, r])), ...Object.fromEntries(Object.entries(current).filter(([id]) => lib.active.some((r) => r.runId === id))) }))
    })
  }, [])

  useEffect(() => {
    refresh()
    const stops = [
      window.api.onWorkflowsChanged(refresh),
      window.api.onWorkflowRunUpdate((run) => setRuns((r) => ({ ...r, [run.runId]: run }))),
      window.api.onWorkflowStep(({ runId, record }) => setRecords((r) => ({ ...r, [runId]: [...(r[runId] ?? []).slice(-300), record] }))),
      window.api.onWorkflowRunFinished((summary) => {
        setRuns(({ [summary.runId]: _done, ...rest }) => rest)
        onNotify(
          summary.status === 'completed' ? `“${summary.workflowName}” finished.` : summary.status === 'failed' ? `“${summary.workflowName}” failed: ${summary.error?.message ?? 'see its history'}` : `“${summary.workflowName}” was stopped.`,
          summary.status === 'failed' ? 'error' : 'info'
        )
        refresh()
      }),
      window.api.onWorkflowNotice((notice) => onNotify(notice.message, 'warn')),
      window.api.onWorkflowRecording((recording) => setLibrary((lib) => (lib ? { ...lib, recording } : lib)))
    ]
    return () => stops.forEach((stop) => stop())
  }, [refresh, onNotify])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || openId || runRequest || draftOpen) return
      const el = document.activeElement
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, openId, runRequest, draftOpen])

  const visible = useMemo(() => {
    if (!library) return []
    const q = query.trim().toLowerCase()
    const matchesQuery = (w: Workflow): boolean => !q || `${w.name} ${w.description} ${w.tags.join(' ')}`.toLowerCase().includes(q)
    const list = library.workflows.filter((w) => {
      if (!matchesQuery(w)) return false
      switch (filter) {
        case 'all':
          return w.status !== 'archived' && !w.template
        case 'favorites':
          return w.favorite && w.status !== 'archived'
        case 'recent':
          return Boolean(library.stats[w.id]?.lastRun) && w.status !== 'archived'
        case 'failed':
          return library.stats[w.id]?.lastRun?.status === 'failed'
        case 'scheduled':
          return Boolean(library.nextRuns[w.id])
        case 'templates':
          return w.template && w.status !== 'archived'
        case 'archived':
          return w.status === 'archived'
      }
    })
    if (filter === 'recent') return list.sort((a, b) => (library.stats[b.id]?.lastRun?.finishedAt ?? 0) - (library.stats[a.id]?.lastRun?.finishedAt ?? 0))
    return list
  }, [library, filter, query])

  const act = async (action: () => Promise<unknown>, failure: string): Promise<void> => {
    try {
      await action()
    } catch (err) {
      onNotify(`${failure}: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)}`, 'error')
    }
  }

  const startRun = (workflow: Workflow, debug = false): void => {
    // Inputs are asked for first; a workflow without inputs starts straight away.
    if (workflow.inputs.length || debug) return setRunRequest({ workflow, debug })
    void act(async () => {
      const result = await window.api.runWorkflow(workflow.id, { debug })
      if (!result.ok) {
        onNotify(`“${workflow.name}” can’t run yet: ${result.issues[0]?.message ?? result.message}`, 'error')
        setOpenId(workflow.id)
      } else setRuns((r) => ({ ...r, [result.run.runId]: result.run }))
    }, `Couldn't start “${workflow.name}”`)
  }

  if (openId) {
    return (
      <>
        <WorkflowEditor workflowId={openId} runs={Object.values(runs)} records={records} onBack={() => setOpenId(null)} onNotify={onNotify} onRun={startRun} />
        {runRequest && (
          <RunDialog
            workflow={runRequest.workflow}
            debug={runRequest.debug}
            canRememberSecrets={library?.canRememberSecrets === true}
            onCancel={() => setRunRequest(null)}
            onStarted={(run) => {
              setRuns((r) => ({ ...r, [run.runId]: run }))
              setRunRequest(null)
            }}
          />
        )}
      </>
    )
  }

  const recording = library?.recording
  const activeRuns = Object.values(runs)

  return (
    <section className="images-view wf-library" aria-label="Workflows">
      <header className="images-head">
        <div>
          <h2>Workflows</h2>
          <span className="hud-label">{library ? `${library.workflows.filter((w) => w.status !== 'archived').length} saved · ${activeRuns.length} running` : 'Loading…'}</span>
        </div>
        <div className="wf-head-actions">
          <button type="button" className="queue-btn primary" onClick={() => void act(async () => setOpenId((await window.api.createWorkflow('Untitled workflow')).id), "Couldn't create a workflow")}>
            <Plus size={11} /> New
          </button>
          <button
            type="button"
            className="queue-btn"
            disabled={recording?.active}
            onClick={() => void act(async () => (await window.api.startWorkflowRecording(), onNotify('Recording. Use the Orbis browser; your actions become steps.')), "Couldn't start recording")}
          >
            <Radio size={11} /> Record
          </button>
          <button type="button" className="queue-btn" onClick={() => setDraftOpen(true)}>
            <Sparkles size={11} /> Ask Orion
          </button>
          <button
            type="button"
            className="queue-btn"
            onClick={() =>
              void act(async () => {
                const imported = await window.api.importWorkflowFile()
                if (!imported) return
                onNotify(imported.issues.length ? `Imported “${imported.workflow.name}”. ${imported.issues.length} thing${imported.issues.length === 1 ? '' : 's'} to check before running.` : `Imported “${imported.workflow.name}”.`, imported.issues.some((i) => i.level === 'error') ? 'warn' : 'info')
                setOpenId(imported.workflow.id)
              }, "Couldn't import")
            }
          >
            <Upload size={11} /> Import
          </button>
          <button type="button" className="sb-icon" aria-label="Close workflows" title="Close (Esc)" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      {recording?.active && (
        <div className="wf-banner recording" role="status">
          <Radio size={14} className={recording.paused ? '' : 'wf-pulse'} />
          <span>
            {recording.paused ? 'Recording paused' : 'Recording'} · {recording.steps.length} step{recording.steps.length === 1 ? '' : 's'}
            {recording.steps.length ? ` · last: ${recording.steps.at(-1)!.name}` : ''}
          </span>
          <button type="button" className="queue-btn" onClick={() => void window.api.pauseWorkflowRecording(!recording.paused)}>
            {recording.paused ? <Play size={11} /> : <Pause size={11} />} {recording.paused ? 'Resume' : 'Pause'}
          </button>
          <input className="hud-input compact" value={recordName} placeholder="Name" aria-label="Name for the recorded workflow" onChange={(e) => setRecordName(e.target.value)} />
          <button
            type="button"
            className="queue-btn primary"
            disabled={!recording.steps.length}
            onClick={() =>
              void act(async () => {
                const saved = await window.api.saveWorkflowRecording(recordName)
                setRecordName('')
                setOpenId(saved.id)
              }, "Couldn't save the recording")
            }
          >
            <CircleStop size={11} /> Stop and save
          </button>
          <button type="button" className="queue-btn danger" onClick={() => void window.api.stopWorkflowRecording()}>
            Discard
          </button>
        </div>
      )}

      {library?.checkpoints.map((cp) => {
        const w = library.workflows.find((x) => x.id === cp.workflowId)
        return (
          <div key={cp.runId} className="wf-banner" role="status">
            <span>
              A run of <b>{w?.name ?? 'a deleted workflow'}</b> was interrupted after step {cp.nextTopIndex} ({ago(cp.savedAt)}).
            </span>
            {w && (
              <button
                type="button"
                className="queue-btn primary"
                onClick={() =>
                  void act(async () => {
                    const result = await window.api.resumeWorkflowRun(cp.runId)
                    if (!result.ok) onNotify(result.message, 'error')
                    refresh()
                  }, "Couldn't resume")
                }
              >
                <Play size={11} /> Resume
              </button>
            )}
            <button type="button" className="queue-btn" onClick={() => void window.api.discardWorkflowCheckpoint(cp.runId).then(refresh)}>
              Discard
            </button>
          </div>
        )
      })}

      {activeRuns.map((run) => (
        <div key={run.runId} className="wf-banner running" role="status">
          <LoaderCircle size={14} className={run.state.status === 'running' ? 'spin' : ''} />
          <span>
            <b>{run.workflowName}</b> · {run.state.status}
            {run.state.currentStep ? ` · ${run.state.currentStep}` : ''}
            {run.state.waitingFor ? ` · ${run.state.waitingFor.message}` : ''}
          </span>
          <button type="button" className="queue-btn" onClick={() => setOpenId(run.workflowId)}>
            Open
          </button>
          {run.state.status === 'paused' || run.state.status === 'waiting-user' ? (
            <button type="button" className="queue-btn primary" onClick={() => void window.api.controlWorkflowRun(run.runId, 'resume')}>
              <Play size={11} /> Continue
            </button>
          ) : (
            <button type="button" className="queue-btn" onClick={() => void window.api.controlWorkflowRun(run.runId, 'pause')}>
              <Pause size={11} /> Pause
            </button>
          )}
          <button type="button" className="queue-btn danger" onClick={() => void window.api.controlWorkflowRun(run.runId, 'stop')}>
            <CircleStop size={11} /> Stop
          </button>
        </div>
      ))}

      <div className="wf-toolbar">
        <label className="sb-search wf-search">
          <Search size={14} />
          <input value={query} placeholder="Search workflows" aria-label="Search workflows" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="wf-filters" role="tablist" aria-label="Filter workflows">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`wf-chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!library ? (
        <div className="images-empty">
          <LoaderCircle size={22} className="spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="images-empty">
          <WorkflowIcon size={30} />
          <p>{library.workflows.length ? 'No workflows match.' : 'No workflows yet.'}</p>
          {!library.workflows.length && <small>Create one, record what you do in the browser, or describe it to Orion.</small>}
        </div>
      ) : (
        <div className="wf-grid">
          {visible.map((w) => {
            const stats = library.stats[w.id]
            const next = library.nextRuns[w.id]
            const running = activeRuns.some((r) => r.workflowId === w.id)
            return (
              <article key={w.id} className={`wf-card${w.pinned ? ' pinned' : ''}`}>
                <header>
                  <span className="wf-icon" style={{ background: w.color }} aria-hidden="true">
                    {w.icon}
                  </span>
                  <div className="wf-card-title">
                    <b className="truncate" title={w.name}>
                      {w.name}
                    </b>
                    <small className="wf-muted">
                      {countSteps(w.steps)} step{countSteps(w.steps) === 1 ? '' : 's'} · v{w.version}
                      {w.trigger.type !== 'manual' ? ` · starts ${w.trigger.type === 'appStart' ? 'with Orbis' : `on ${w.trigger.type}`}` : ''}
                    </small>
                  </div>
                  <button type="button" className={`b-icon${w.favorite ? ' active' : ''}`} aria-label={w.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={w.favorite} onClick={() => void act(() => window.api.saveWorkflow({ ...w, favorite: !w.favorite }), "Couldn't update")}>
                    <Star size={13} fill={w.favorite ? 'currentColor' : 'none'} />
                  </button>
                </header>
                {w.description && <p className="wf-card-desc">{w.description}</p>}
                <p className="wf-card-meta">
                  {stats?.lastRun ? (
                    <>
                      <span className={`wf-status ${stats.lastRun.status}`}>{stats.lastRun.status}</span> {ago(stats.lastRun.finishedAt)} · {stats.runs} run{stats.runs === 1 ? '' : 's'} · {stats.succeeded} ok
                      {stats.failed ? ` · ${stats.failed} failed` : ''}
                    </>
                  ) : (
                    <span className="wf-muted">Never run</span>
                  )}
                  {next && <span className="wf-muted"> · next {new Date(next).toLocaleString()}</span>}
                </p>
                {confirmDelete === w.id ? (
                  <div className="wf-card-actions">
                    <span>Delete “{w.name}” and its versions?</span>
                    <button
                      type="button"
                      className="queue-btn danger"
                      onClick={() =>
                        void act(async () => {
                          await window.api.removeWorkflow(w.id)
                          setConfirmDelete(null)
                        }, "Couldn't delete")
                      }
                    >
                      Delete
                    </button>
                    <button type="button" className="queue-btn" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="wf-card-actions">
                    {w.template ? (
                      <button type="button" className="queue-btn primary" onClick={() => void act(async () => setOpenId((await window.api.createWorkflow(`${w.name} copy`, w.id)).id), "Couldn't use the template")}>
                        <Plus size={11} /> Use template
                      </button>
                    ) : (
                      <button type="button" className="queue-btn primary" disabled={running || w.status === 'archived'} onClick={() => startRun(w)}>
                        <Play size={11} /> {running ? 'Running' : 'Run'}
                      </button>
                    )}
                    <button type="button" className="queue-btn" onClick={() => setOpenId(w.id)}>
                      <Pencil size={11} /> Edit
                    </button>
                    <button type="button" className="b-icon" aria-label={w.pinned ? 'Unpin' : 'Pin'} title={w.pinned ? 'Unpin' : 'Pin to the top'} onClick={() => void act(() => window.api.saveWorkflow({ ...w, pinned: !w.pinned }), "Couldn't update")}>
                      {w.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button type="button" className="b-icon" aria-label="Duplicate" title="Duplicate" onClick={() => void act(() => window.api.duplicateWorkflow(w.id), "Couldn't duplicate")}>
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      className="b-icon"
                      aria-label="Export"
                      title="Export (secrets are left out)"
                      onClick={() => void act(async () => {
                        const path = await window.api.exportWorkflowFile(w.id)
                        if (path) onNotify(`Exported to ${path}.`)
                      }, "Couldn't export")}
                    >
                      <Download size={13} />
                    </button>
                    <button
                      type="button"
                      className="b-icon"
                      aria-label={w.status === 'archived' ? 'Restore' : 'Archive'}
                      title={w.status === 'archived' ? 'Restore' : 'Archive'}
                      onClick={() => void act(() => window.api.saveWorkflow({ ...w, status: w.status === 'archived' ? 'draft' : 'archived' }), "Couldn't update")}
                    >
                      {w.status === 'archived' ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    </button>
                    <button type="button" className="b-icon danger" aria-label="Delete" title="Delete" onClick={() => setConfirmDelete(w.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {draftOpen && (
        <div className="ext-prompt-backdrop control-prompt-backdrop">
          <form
            className="popover glass ext-prompt wf-run-dialog"
            role="dialog"
            aria-label="Describe a workflow to Orion"
            onSubmit={(e) => {
              e.preventDefault()
              if (!draftText.trim()) return
              setDrafting(true)
              void act(async () => {
                const draft = await window.api.draftWorkflow(draftText)
                const saved = await window.api.saveWorkflow({ ...draft, status: 'draft' }, 'Drafted by Orion')
                setDraftOpen(false)
                setDraftText('')
                onNotify('Orion drafted the workflow. Review the steps before running it.')
                setOpenId(saved.id)
              }, "Orion couldn't draft it").finally(() => setDrafting(false))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setDraftOpen(false)
              }
            }}
          >
            <div className="ext-prompt-head">
              <Sparkles size={24} aria-hidden="true" />
              <h3>Describe the workflow</h3>
            </div>
            <textarea className="hud-input" rows={5} autoFocus value={draftText} placeholder="e.g. Open my supplier's order page, find today's orders, copy each order number into a list, then open the tracking site and check each one." onChange={(e) => setDraftText(e.target.value)} />
            <p className="wf-muted">Orion writes the steps; nothing runs until you review and start it.</p>
            <div className="ext-prompt-actions">
              <button type="button" className="tab-edit-btn" onClick={() => setDraftOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="tab-edit-btn primary" disabled={drafting || !draftText.trim()}>
                {drafting ? 'Drafting…' : 'Draft it'}
              </button>
            </div>
          </form>
        </div>
      )}

      {runRequest && (
        <RunDialog
          workflow={runRequest.workflow}
          debug={runRequest.debug}
          canRememberSecrets={library?.canRememberSecrets === true}
          onCancel={() => setRunRequest(null)}
          onStarted={(run) => {
            setRuns((r) => ({ ...r, [run.runId]: run }))
            setRunRequest(null)
          }}
        />
      )}
    </section>
  )
}
