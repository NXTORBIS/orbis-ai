import { useEffect, useState } from 'react'
import { newWorkspace } from '../../../shared/workspaces'
import ProjectFileList from './ProjectFileList'
import { CHAT_MODELS, modelLabel } from '../../../shared/models'
import { AUTO_MODEL } from '../../../shared/modelRoute'
import { Check, Copy, FolderOpen, Layers, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Modal, Surface } from '../ui'
import type { Workspace, WorkspaceSummary } from '../../../shared/workspaces'
import { WORKSPACE_COLORS } from '../../../shared/workspaces'
import type { NoticeKind } from '../lib/notices'

type Listed = Workspace & { summary: WorkspaceSummary }

const when = (time: number | undefined): string => {
  if (!time) return 'never opened'
  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days === 0) return 'opened today'
  if (days === 1) return 'opened yesterday'
  return `opened ${days} days ago`
}

/**
 * Workspaces: named sets of pages you can come back to. Saving takes what the browser holds now (never private tabs),
 * and opening one puts those pages and groups back — telling you first what it would close.
 */
export default function WorkspacesView({ onClose, onNotify }: { onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<Listed[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState<{ id: string; replace: boolean; plan: { open: number; close: number; keep: number } } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const { workspaces: list, currentId: current } = await window.api.listWorkspaces()
    setWorkspaces(list)
    setCurrentId(current)
  }

  useEffect(() => {
    void load()
    return window.api.onWorkspacesChanged(() => void load())
  }, [])

  const saveCurrent = async (): Promise<void> => {
    const chosen = name.trim() || `Workspace ${workspaces.length + 1}`
    try {
      const saved = await window.api.saveCurrentWorkspace(chosen, { color: WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length] })
      setName('')
      onNotify(`Saved “${saved.name}” with ${saved.tabs.length} page${saved.tabs.length === 1 ? '' : 's'}`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Nothing to save', 'error')
    }
  }

  const askToOpen = async (id: string, replace: boolean): Promise<void> => {
    const plan = await window.api.planWorkspaceOpen(id, replace)
    // Nothing would be closed, so there is nothing to warn about.
    if (!plan.close) return void open(id, replace)
    setConfirming({ id, replace, plan })
  }

  const open = async (id: string, replace: boolean): Promise<void> => {
    setBusy(id)
    setConfirming(null)
    try {
      const result = await window.api.openWorkspace(id, replace)
      onNotify(`${result.name}: ${result.opened} page${result.opened === 1 ? '' : 's'} open`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'That workspace could not be opened', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Surface
      title="Workspaces"
      closeLabel="Close workspaces"
      onClose={onClose}
      className="spaces-view"
      actions={
        <>
          <label className="spaces-save">
            <Save size={13} />
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveCurrent()} placeholder="Save what is open as…" aria-label="Name for the workspace" />
          </label>
          <button type="button" className="queue-btn primary" onClick={() => void saveCurrent()}>
            <Plus size={14} /> Save open pages
          </button>
          {/* A project set up elsewhere. It brings how it works, never what it referred to there. */}
          <button
            type="button"
            className="queue-btn small"
            onClick={() =>
              void window.api.importProject().then(async (done) => {
                if (done.message) return onNotify(done.message, 'error')
                if (!done.ok || !done.project) return
                const made = newWorkspace({ name: done.project.name })
                await window.api.saveWorkspace({
                  ...made,
                  project: { goal: done.project.goal, instructions: done.project.instructions, outputFormat: done.project.outputFormat, model: done.project.model, items: [] }
                })
                onNotify([`“${done.project.name}” was set up.`, ...(done.notes ?? [])].join(' '))
              })
            }
          >
            Open a project
          </button>
        </>
      }
    >
      <div className="spaces-grid">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className={`space-card${workspace.id === currentId ? ' current' : ''}`} style={{ borderTopColor: workspace.color }}>
            <div className="space-head">
              <input className="space-name" value={workspace.name} aria-label={`Name of ${workspace.name}`} onChange={(e) => void window.api.renameWorkspace(workspace.id, e.target.value)} />
              {workspace.id === currentId && (
                <span className="space-open" title="This is what the browser is showing">
                  <Check size={12} /> open
                </span>
              )}
            </div>
            <p className="space-meta view-muted">
              {workspace.summary.tabs} page{workspace.summary.tabs === 1 ? '' : 's'}
              {workspace.summary.groups ? ` · ${workspace.summary.groups} group${workspace.summary.groups === 1 ? '' : 's'}` : ''}
              {workspace.summary.pinned ? ` · ${workspace.summary.pinned} pinned` : ''} · {when(workspace.lastOpenedAt)}
            </p>
            <p className="space-sites view-muted">{workspace.summary.sites.join(' · ') || 'No sites'}</p>
            {workspace.project ? (
              <div className="space-project">
                <label>
                  <span className="view-muted">Project goal</span>
                  <input
                    defaultValue={workspace.project.goal}
                    maxLength={500}
                    placeholder="What this project is for"
                    aria-label={`Goal of ${workspace.name}`}
                    onBlur={(e) => e.target.value.trim() !== workspace.project?.goal && void window.api.saveWorkspace({ ...workspace, project: { ...workspace.project!, goal: e.target.value } })}
                  />
                </label>
                {/*
                  * The goal above is something Orion is told about. This is something Orion follows -- and only while
                  * it is answering inside this project, which is the whole reason it is here and not in Settings.
                  */}
                <label>
                  <span className="view-muted">How Orion should work here</span>
                  <textarea
                    defaultValue={workspace.project.instructions}
                    maxLength={2000}
                    rows={3}
                    placeholder={'Use SI units. Show the derivation. Answer in Hindi.'}
                    aria-label={`How Orion should work in ${workspace.name}`}
                    onBlur={(e) =>
                      e.target.value.trim() !== workspace.project?.instructions &&
                      void window.api
                        .saveWorkspace({ ...workspace, project: { ...workspace.project!, instructions: e.target.value } })
                        .then(() => onNotify(e.target.value.trim() ? `Orion will work that way in “${workspace.name}”.` : `Orion will work normally in “${workspace.name}”.`))
                    }
                  />
                  <span className="view-muted small">Followed in this project only. Chats you put in it are answered this way.</span>
                </label>
                <label>
                  <span className="view-muted">How answers should come out</span>
                  <input
                    defaultValue={workspace.project.outputFormat}
                    maxLength={400}
                    placeholder="A table. Bullet points, no preamble. Code only."
                    aria-label={`How answers should come out in ${workspace.name}`}
                    onBlur={(e) =>
                      e.target.value.trim() !== workspace.project?.outputFormat &&
                      void window.api.saveWorkspace({ ...workspace, project: { ...workspace.project!, outputFormat: e.target.value } })
                    }
                  />
                </label>
                {/* The model this project answers with. Empty means whatever the person is using, which is the default. */}
                <label>
                  <span className="view-muted">Answer with</span>
                  <select
                    defaultValue={workspace.project.model}
                    aria-label={`Model used in ${workspace.name}`}
                    onChange={(e) => void window.api.saveWorkspace({ ...workspace, project: { ...workspace.project!, model: e.target.value } })}
                  >
                    <option value="">Whatever I am using</option>
                    <option value={AUTO_MODEL}>{modelLabel(AUTO_MODEL)}</option>
                    {CHAT_MODELS.filter((one) => one.id !== AUTO_MODEL).map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.label}
                      </option>
                    ))}
                  </select>
                </label>
                {/* The files this project keeps. Searched like attachments, so holding six does not mean sending six. */}
                <ProjectFileList projectId={workspace.id} onNotify={onNotify} />
                <div className="setting-row-inline">
                  <button
                    type="button"
                    className="queue-btn small"
                    onClick={() =>
                      void window.api.exportProject(workspace.id).then((done) => {
                        if (done.message) onNotify(done.message, 'error')
                        else if (done.ok) onNotify(`Saved “${workspace.name}”. It carries how the project works, not what it refers to.`)
                      })
                    }
                  >
                    Export this project
                  </button>
                </div>
                <p className="view-muted">
                  {workspace.project.items.length} {workspace.project.items.length === 1 ? 'item' : 'items'} in this project · add research, notes, tasks and more from Galaxy
                </p>
              </div>
            ) : (
              <button type="button" className="queue-btn small space-make-project" onClick={() => void window.api.saveWorkspace({ ...workspace, project: { goal: '', instructions: '', model: '', outputFormat: '', items: [] } }).then(() => onNotify(`“${workspace.name}” is now a project.`))}>
                Make this a project
              </button>
            )}
            <div className="space-colors" role="group" aria-label="Colour">
              {WORKSPACE_COLORS.map((c) => (
                <button key={c} type="button" className={`board-color${workspace.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => void window.api.saveWorkspace({ ...workspace, color: c })} />
              ))}
            </div>
            <label className="space-auto">
              <input type="checkbox" checked={workspace.autoUpdate} onChange={(e) => void window.api.saveWorkspace({ ...workspace, autoUpdate: e.target.checked })} />
              <span>Keep up to date as I browse</span>
            </label>
            <div className="space-actions">
              <button type="button" className="queue-btn primary small" disabled={busy === workspace.id} onClick={() => void askToOpen(workspace.id, true)}>
                <FolderOpen size={13} /> Open
              </button>
              <button type="button" className="queue-btn small" disabled={busy === workspace.id} onClick={() => void askToOpen(workspace.id, false)} title="Open its pages without closing what is open">
                <Layers size={13} /> Add
              </button>
              <button type="button" className="queue-btn small" onClick={() => void window.api.updateWorkspaceFromWindow(workspace.id).then((saved) => onNotify(`“${saved.name}” now holds ${saved.tabs.length} page${saved.tabs.length === 1 ? '' : 's'}`)).catch((err: unknown) => onNotify(err instanceof Error ? err.message : 'Could not update', 'error'))} title="Save what is open over this workspace">
                <RefreshCw size={13} /> Update
              </button>
              <button type="button" className="icon-btn" aria-label={`Duplicate ${workspace.name}`} onClick={() => void window.api.duplicateWorkspace(workspace.id)}>
                <Copy size={14} />
              </button>
              <button type="button" className="icon-btn danger" aria-label={`Delete ${workspace.name}`} onClick={() => void window.api.removeWorkspace(workspace.id).then(() => onNotify('Workspace deleted'))}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!workspaces.length && <p className="view-empty">No workspaces yet. Open the pages you want to keep together, then save them here.</p>}
      </div>

      {/* The other dialog Escape did nothing in. It is also a question rather than a form, so it says
           `alertdialog` now and is read out at once rather than waiting to be found. */}
      {confirming && (
        <Modal
          label="Open this workspace?"
          asking
          onClose={() => setConfirming(null)}
          className="space-confirm"
        >
          <>
            <h3>Open “{workspaces.find((w) => w.id === confirming.id)?.name}”?</h3>
            <p className="view-muted">
              {confirming.plan.open} page{confirming.plan.open === 1 ? '' : 's'} would open, {confirming.plan.close} would close
              {confirming.plan.keep ? `, ${confirming.plan.keep} stay open` : ''}.
            </p>
            <div className="og-inline">
              <button type="button" className="queue-btn primary" onClick={() => void open(confirming.id, true)}>
                Open it
              </button>
              <button type="button" className="queue-btn" onClick={() => void open(confirming.id, false)}>
                Keep what is open too
              </button>
              <button type="button" className="queue-btn" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </div>
          </>
        </Modal>
      )}
    </Surface>
  )
}
