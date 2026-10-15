import { useState } from 'react';
import { call, runJob } from '../../api';
import { app, confirm, openDialog, prompt, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane, navigate, type Pane } from '../../state/workspace';
import { Button, EmptyState, Pill, ProgressBar } from '../../ui/components';
import { formatDate } from '../../ui/format';
import { FolderPicker, JobPauseButton, useJobPaused } from './common';
import { ReferenceList, type CatalogItem } from './LibraryViews';

interface Detected { root: string; name: string; kind: string; markers: string[]; registered: boolean }

/** Projects: folders recognised by their project files (or added explicitly), with associated files anywhere on disk. */
export function ProjectsView() {
  const projects = useStore(app, (s) => s.projects);
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const [root, setRoot] = useState(home);
  const [found, setFound] = useState<{ found: Detected[]; checked: number; complete: boolean } | null>(null);
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const [progress, setProgress] = useState<{ checked: number; found: number } | null>(null);
  const paused = useJobPaused(job?.jobId);

  const find = () => {
    setFound(null);
    const j = runJob<{ found: Detected[]; checked: number; complete: boolean }>((jobId) => call('proj:find', { path: root, jobId }), (p) => setProgress(p as typeof progress), 'Finding projects');
    setJob({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then((r) => {
      setJob(null);
      setProgress(null);
      if (r.value) setFound(r.value);
    }, (e) => {
      setJob(null);
      setProgress(null);
      toastError(e);
    });
  };
  const add = async (d: { root: string; name: string }) => {
    await call('proj:create', { root: d.root, name: d.name }).then(() => toast({ level: 'success', title: `Added project “${d.name}”`, detail: 'Nothing in the folder was changed.' }), toastError);
    setFound((f) => (f ? { ...f, found: f.found.map((x) => (x.root === d.root ? { ...x, registered: true } : x)) } : f));
  };

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Projects</h1>
        <p className="muted">A project is a folder recognised by its project files (package.json, Cargo.toml, go.mod, pyproject.toml, .sln, a Git repository…) or one you add yourself. Associating a file with a project only records a reference — files are never moved.</p>
      </header>
      {!projects.length ? <EmptyState icon="project" title="No projects yet" body="Find projects in a folder below, or right-click a folder → Add as project." /> : (
        <div className="rule-list">
          {projects.map((p) => (
            <div key={p.id} className={`rule ${p.rootExists === false ? 'is-disabled' : ''}`}>
              <div className="rule-main">
                <strong>{p.name}</strong>
                <span className="muted"><Pill tone="accent">{p.kind}</Pill> <span className="mono">{p.root}</span>{p.rootExists === false ? ' — folder not found' : ''}</span>
                <span className="muted small">{p.markers.length ? `Recognised by ${p.markers.join(', ')}` : 'Added manually'} · {p.itemCount} associated item{p.itemCount === 1 ? '' : 's'} · added {formatDate(p.createdMs)}</span>
              </div>
              <div className="row-actions">
                <Button size="sm" onClick={() => void navigate(activePane().id, { kind: 'project', id: p.id })}>Open</Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  const name = await prompt({ title: 'Rename project', label: 'Name', initial: p.name, confirmLabel: 'Rename' });
                  if (name) await call('proj:rename', { id: p.id, name }).catch(toastError);
                }}>Rename</Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (await confirm({ title: `Remove project “${p.name}”?`, body: 'Only the project entry and its associations are removed. The folder and every file stay exactly where they are.', confirmLabel: 'Remove project' })) await call('proj:delete', { id: p.id }).catch(toastError);
                }}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <section className="home-section">
        <div className="section-head"><h2>Find projects in a folder</h2></div>
        <div className="tool-controls">
          <FolderPicker value={root} onChange={setRoot} label="Look in" />
          {job ? <><JobPauseButton jobId={job.jobId} /><button type="button" className="btn btn-default btn-md" onClick={job.cancel}>Stop</button></> : <button type="button" className="btn btn-primary btn-md" onClick={find}>Find projects</button>}
        </div>
        {progress && <div className="tool-progress" role="status"><ProgressBar label="Looking for projects" tone={paused ? 'warning' : 'accent'} /><span className="tabular">{paused ? 'Paused · ' : ''}{progress.checked} folders checked · {progress.found} found</span></div>}
        {found && (!found.found.length ? <p className="muted">No folders with recognised project files were found (up to four levels deep).</p> : (
          <table className="table">
            <thead><tr><th>Project</th><th className="wide-only">Kind</th><th className="wide-only">Recognised by</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {found.found.map((d) => (
                <tr key={d.root}>
                  <td className="cell-path">{d.name}<div className="mono muted small">{d.root}</div><div className="cell-sub narrow-only">{d.kind} · recognised by <span className="mono">{d.markers.join(', ')}</span></div></td>
                  <td className="wide-only">{d.kind}</td>
                  <td className="mono small wide-only">{d.markers.join(', ')}</td>
                  <td className="row-actions">{d.registered ? <Pill tone="success">added</Pill> : <Button size="sm" onClick={() => void add(d)}>Add</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>
    </div>
  );
}

export function ProjectView({ id, pane, tabId }: { id: string; pane: Pane; tabId: string }) {
  const project = useStore(app, (s) => s.projects.find((p) => p.id === id));
  if (!project) return <EmptyState icon="project" title="This project no longer exists" />;
  return (
    <ReferenceList
      title={project.name}
      subtitle={`${project.kind} · ${project.root}${project.rootExists === false ? ' (folder not found)' : ''}`}
      pane={pane}
      tabId={tabId}
      load={() => call<CatalogItem[]>('proj:items', { id })}
      removeLabel="Remove from project"
      onRemove={async (items) => {
        await call('proj:removeItems', { id, itemIds: items.map((i) => i.id) }).catch(toastError);
      }}
      extraActions={
        <div className="tb-group">
          <Button size="sm" disabled={project.rootExists === false} onClick={() => void navigate(pane.id, { kind: 'fs', path: project.root })}>Open project folder</Button>
          <Button size="sm" variant="ghost" onClick={() => void navigate(pane.id, { kind: 'search', query: `project:"${project.name}" is:file modified:last30days`, scope: [project.root] })}>Recently changed</Button>
        </div>
      }
      emptyTitle="No associated files"
      emptyBody="Files inside the project folder belong to it automatically. To associate files stored elsewhere, right-click them → Add to project."
    />
  );
}

/** Associate the given paths with a project, asking which one. */
export async function addToProjectDialog(paths: string[]): Promise<void> {
  openDialog('addToProject', { paths });
}

export async function addFolderAsProject(dir: string): Promise<void> {
  const detected = await call<{ kind: string; name: string; markers: string[] } | undefined>('proj:detect', { path: dir }).catch(() => undefined);
  const name = await prompt({ title: 'Add as project', label: detected ? `Project name (${detected.kind}, recognised by ${detected.markers.join(', ')})` : 'Project name (no project files recognised; it will be a plain folder project)', initial: detected?.name ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? 'Project', confirmLabel: 'Add project' });
  if (!name) return;
  await call('proj:create', { root: dir, name }).then(() => toast({ level: 'success', title: `Added project “${name}”`, detail: 'Nothing in the folder was changed.' }), toastError);
}
