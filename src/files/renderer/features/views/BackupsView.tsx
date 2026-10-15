import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call, errorShape, runJob } from '../../api';
import { app, confirm, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { schedules, setSchedulesPaused } from '../../state/backups';
import { Button, EmptyState, ErrorState, FileIcon, Loading, Pill, ProgressBar, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatCount, formatDate, formatTimeOfDay } from '../../ui/format';
import { watchOperation } from '../../actions';
import { JobPauseButton, useJobPaused } from './common';
import { BackupJobEditor, RestoreDialog } from './BackupDialogs';
import { describeRetention, type BackupActivity, type BackupJob, type BrowseEntry, type FileVersionRow, type VerifyResult, type VersionInfo } from '../../../shared/backup';
import { describeSchedule } from '../../../shared/schedule';
import { TERMINAL_STATES, type OperationRecord } from '../../../shared/operations';

/**
 * Backups (Tools → Backups, command tools.backups): backup jobs with their last
 * result and next run, Run now / Edit / Delete, the versions of a job, a
 * read-only browser of a version, "versions of this file" and search across
 * versions, restore and verify, and the job's activity log.
 */

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const RESULT_LABEL: Record<string, string> = { completed: 'Completed', completed_with_errors: 'Completed with problems', failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted' };
const tone = (state: string) => (state === 'completed' ? 'success' : state === 'failed' || state === 'interrupted' ? 'error' : 'warning');

function jobOp(ops: Record<string, OperationRecord>, id: string): OperationRecord | undefined {
  return Object.values(ops).find((o) => o.type === 'backup' && !TERMINAL_STATES.has(o.state) && o.origin.endsWith(`:${id}`));
}

export function BackupsView({ paneId: _paneId }: { paneId: string }) {
  const seq = useStore(schedules, (s) => s.seq);
  const sched = useStore(schedules, (s) => s.status);
  const ops = useStore(app, (s) => s.ops);
  const [jobs, setJobs] = useState<BackupJob[] | null>(null);
  const [error, setError] = useState<{ message: string; errorId?: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [editor, setEditor] = useState<{ job?: BackupJob } | null>(null);

  const loadJobs = useCallback(() => {
    call<BackupJob[]>('backup:jobs').then((list) => {
      setJobs(list);
      setError(null);
      setSelectedId((cur) => (cur && list.some((j) => j.id === cur) ? cur : list[0]?.id));
    }, (err) => setError(errorShape(err)));
  }, []);
  useEffect(loadJobs, [loadJobs, seq]);
  const selected = jobs?.find((j) => j.id === selectedId);

  const runNow = async (j: BackupJob) => {
    const rec = await call<OperationRecord>('backup:run', { id: j.id }).catch((err) => {
      toastError(err, `Could not start “${j.name}”`);
      return undefined;
    });
    if (!rec) return;
    watchOperation(rec.id);
    setSelectedId(j.id);
    loadJobs();
  };

  const remove = async (j: BackupJob) => {
    const ok = await confirm({
      title: `Delete backup job “${j.name}”?`,
      body: `Only the job's settings and schedule are removed. The backup store ${j.storePath} and every version in it stay on disk; delete that folder yourself if you no longer need it.`,
      confirmLabel: 'Delete job',
    });
    if (!ok) return;
    await call('backup:deleteJob', { id: j.id }).then(() => toast({ level: 'success', title: `Deleted the job “${j.name}”`, detail: 'Its versions are still in the backup store.' }), toastError);
    loadJobs();
  };

  const scheduled = (sched?.tasks.length ?? 0) > 0;
  return (
    <div className="tool-view scroll-y backups-view">
      <header className="view-header">
        <h1>Backups</h1>
        <p className="muted">Each run keeps a complete, browsable version of your folders on another drive or folder. Unchanged files are shared between versions, so only changes take space. A version counts only once its manifest is written; restores never overwrite anything without asking.</p>
      </header>
      <div className="backup-toolbar">
        <Button variant="primary" icon="plus" onClick={() => setEditor({})}>New backup job…</Button>
        <span className="spacer" />
        {sched && (
          <span className={`backup-sched-state small ${sched.paused ? 'is-paused' : ''}`}>
            <Icon name={sched.paused ? 'scheduleOff' : 'schedule'} size={14} />
            {sched.paused ? 'Schedules paused' : scheduled ? `${formatCount(sched.tasks.length, 'schedule')} active` : 'No schedules'}
          </span>
        )}
        {sched && (sched.paused || scheduled) && (
          <Button size="sm" icon={sched.paused ? 'play' : 'pause'} onClick={() => void setSchedulesPaused(!sched.paused)}>{sched.paused ? 'Resume schedules' : 'Pause all schedules'}</Button>
        )}
      </div>

      <section className="home-section" aria-labelledby="bk-jobs-h">
        <div className="section-head"><h2 id="bk-jobs-h">Backup jobs</h2></div>
        {error ? <ErrorState title="Backup jobs could not be loaded" body={error.message} errorId={error.errorId} />
          : !jobs ? <Loading label="Loading backup jobs" />
            : !jobs.length ? <EmptyState icon="backup" title="No backup jobs yet" body="Choose folders to back up and where to keep the versions. Run it now or on a schedule." />
              : (
                <ul className="rule-list backup-jobs" aria-label="Backup jobs">
                  {jobs.map((j) => <JobRow key={j.id} job={j} op={jobOp(ops, j.id)} current={j.id === selectedId} paused={!!sched?.paused} onSelect={() => setSelectedId(j.id)} onRun={() => void runNow(j)} onEdit={() => setEditor({ job: j })} onDelete={() => void remove(j)} />)}
                </ul>
              )}
      </section>

      {selected && <JobDetails key={selected.id} job={selected} seq={seq} running={!!jobOp(ops, selected.id)} />}
      {editor && (
        <BackupJobEditor job={editor.job} onClose={() => setEditor(null)} onSaved={(j) => {
          setEditor(null);
          setSelectedId(j.id);
          loadJobs();
          toast({ level: 'success', title: editor.job ? `Saved “${j.name}”` : `Created the backup job “${j.name}”`, detail: `Versions are kept in ${j.storePath}.` });
        }} />
      )}
    </div>
  );
}

function JobRow({ job: j, op, current, paused, onSelect, onRun, onEdit, onDelete }: { job: BackupJob; op?: OperationRecord; current: boolean; paused: boolean; onSelect: () => void; onRun: () => void; onEdit: () => void; onDelete: () => void }) {
  const r = j.lastResult;
  const p = op?.progress;
  const pct = p?.totalBytes ? p.completedBytes / p.totalBytes : p?.totalItems ? p.completedItems / p.totalItems : undefined;
  const next = j.schedule.kind === 'manual' ? 'Runs when you choose Run now' : paused ? 'Schedules paused' : j.nextRunMs ? `Next run ${formatDate(j.nextRunMs)}` : j.schedule.kind === 'startup' ? 'Next run when Orbis Files starts' : 'Next run not planned';
  return (
    <li className={`rule backup-job ${current ? 'is-current' : ''}`}>
      <div className="rule-main">
        <strong className="backup-job-name">
          <button type="button" className="link-button" aria-pressed={current} onClick={onSelect}>{j.name}</button>
          <Pill tone="accent" title={describeSchedule(j.schedule, formatTimeOfDay)}>{j.schedule.kind === 'manual' ? 'Manual' : describeSchedule(j.schedule, formatTimeOfDay)}</Pill>
          {op && <Pill tone="accent">{op.state === 'paused' ? 'Paused' : 'Running'}</Pill>}
        </strong>
        <span className="mono muted backup-job-paths" title={`${j.sources.join(', ')} → ${j.storePath}`}>{j.sources.join(', ')} → {j.storePath}</span>
        <span className="small backup-job-meta">
          <span>{r ? <>Last run {formatDate(r.finishedMs)} · <span className={`backup-result is-${tone(r.state)}`}>{RESULT_LABEL[r.state] ?? r.state}</span>{r.version ? ` · ${r.newFiles ?? 0} new, ${r.changedFiles ?? 0} changed` : ''}</> : 'Never run'}</span>
          <span className="muted backup-next" data-next-run={j.nextRunMs ?? ''}>{next}</span>
        </span>
        {op && (
          <div className="backup-progress">
            <ProgressBar label={`Backing up ${j.name}`} value={pct} tone={op.state === 'paused' ? 'warning' : 'accent'} />
            <span className="muted small tabular">{p?.totalItems !== undefined ? `${(p.completedItems).toLocaleString()} of ${p.totalItems.toLocaleString()} items${p.totalBytes ? ` · ${formatBytes(p.completedBytes)} of ${formatBytes(p.totalBytes)} to copy` : ''}` : 'Reading the folders…'}</span>
          </div>
        )}
      </div>
      <div className="row-actions">
        <Button size="sm" variant="primary" icon="play" disabled={!!op} onClick={onRun} aria-label={`Run ${j.name} now`}>Run now</Button>
        <Button size="sm" onClick={onSelect} aria-label={`Versions of ${j.name}`}>Versions</Button>
        <Button size="sm" disabled={!!op} onClick={onEdit} aria-label={`Edit ${j.name}`}>Edit</Button>
        <Button size="sm" variant="ghost" disabled={!!op} onClick={onDelete} aria-label={`Delete ${j.name}`}>Delete…</Button>
      </div>
    </li>
  );
}

function JobDetails({ job, seq, running }: { job: BackupJob; seq: number; running: boolean }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [vError, setVError] = useState<string | null>(null);
  const [activity, setActivity] = useState<BackupActivity[]>([]);
  const [browse, setBrowse] = useState<{ version: string; dir: string } | null>(null);
  const [verify, setVerify] = useState<{ version: string; jobId?: string; progress?: { done: number; total: number }; result?: VerifyResult; error?: string } | null>(null);
  const [restore, setRestore] = useState<{ version: string; items: string[] } | null>(null);
  const [fileRel, setFileRel] = useState<string | null>(null);
  const verifyPaused = useJobPaused(verify?.jobId);

  useEffect(() => {
    call<VersionInfo[]>('backup:versions', { id: job.id }).then((v) => {
      setVersions(v);
      setVError(null);
      setBrowse((b) => (b && v.some((x) => x.name === b.version && x.complete) ? b : null));
    }, (err) => setVError(errorShape(err).message));
    call<BackupActivity[]>('backup:activity', { id: job.id, limit: 50 }).then(setActivity, () => undefined);
  }, [job.id, seq]);

  const startVerify = (version: string) => {
    const j = runJob<VerifyResult>((jobId) => call('backup:verify', { id: job.id, version, jobId }), (p) => setVerify((v) => (v ? { ...v, progress: p as { done: number; total: number } } : v)), `Verify backup ${version}`);
    setVerify({ version, jobId: j.jobId });
    j.promise.then((r) => setVerify((v) => (v ? { ...v, jobId: undefined, result: r.value, error: r.cancelled ? 'Stopped.' : undefined } : v)), (err) => setVerify((v) => (v ? { ...v, jobId: undefined, error: errorShape(err).message } : v)));
  };

  const doRestore = async (target: { kind: 'original' } | { kind: 'folder'; path: string }) => {
    if (!restore) return;
    const recs = await call<OperationRecord[]>('backup:restore', { jobId: job.id, version: restore.version, items: restore.items, target }).catch((err) => {
      toastError(err, 'Could not start the restore');
      return undefined;
    });
    setRestore(null);
    if (!recs) return;
    recs.forEach((r) => watchOperation(r.id));
  };

  const complete = versions?.filter((v) => v.complete) ?? [];
  return (
    <>
      <section className="home-section" aria-labelledby="bk-versions-h">
        <div className="section-head">
          <h2 id="bk-versions-h">Versions of “{job.name}”</h2>
          <span className="muted small">{describeRetention(job.retention)}</span>
        </div>
        <p className="mono muted small backup-store-path">{job.storePath}</p>
        {vError ? <ErrorState title="The versions could not be read" body={vError} />
          : !versions ? <Loading label="Reading versions" />
            : !versions.length ? <p className="muted small">No versions yet. {running ? 'The first run is in progress.' : 'Choose Run now to make the first one.'}</p>
              : (
                <div className="backup-table-wrap">
                  <table className="table backup-versions" aria-label={`Versions of ${job.name}`}>
                    <thead><tr><th scope="col">Version</th><th scope="col" className="num">Files</th><th scope="col" className="num bk-col-size">Size</th><th scope="col" className="num bk-col-changes">New / changed</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.name} className={browse?.version === v.name ? 'is-selected' : ''} data-version={v.name}>
                          <td><div className="tabular">{formatDate(v.startedMs)}</div><div className="mono muted small">{v.name}</div></td>
                          <td className="num tabular">{v.stats ? v.stats.files.toLocaleString() : '—'}</td>
                          <td className="num tabular bk-col-size">{v.stats ? formatBytes(v.stats.bytes) : '—'}</td>
                          <td className="num tabular bk-col-changes">{v.stats ? `${v.stats.newFiles} / ${v.stats.changedFiles}` : '—'}</td>
                          <td>
                            {v.complete ? <Pill tone={v.stats?.errors ? 'warning' : 'success'} title={v.storage === 'objects' ? 'Contents are stored once in the objects folder (this drive has no hard links)' : 'Unchanged files are hard links to the previous version'}>{v.stats?.errors ? `${v.stats.errors} unreadable` : 'Complete'}</Pill> : <Pill tone="warning" title={v.problem}>Incomplete</Pill>}
                            {v.complete && <div className="muted small">{v.storage === 'objects' ? 'Stored objects' : 'Hard links'}</div>}
                            {!v.complete && <div className="muted small">{v.problem} Never used.</div>}
                          </td>
                          <td className="row-actions">
                            {v.complete && <Button size="sm" onClick={() => setBrowse({ version: v.name, dir: '' })} aria-label={`Browse version ${v.name}`}>Browse</Button>}
                            {v.complete && <Button size="sm" variant="ghost" icon="shield" disabled={!!verify?.jobId || running} onClick={() => startVerify(v.name)} aria-label={`Verify version ${v.name}`}>Verify</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        {verify && <VerifyPanel verify={verify} paused={verifyPaused} onClose={() => setVerify(null)} />}
      </section>

      {browse && complete.some((v) => v.name === browse.version) && (
        <VersionBrowser job={job} version={browse.version} dir={browse.dir} onDir={(dir) => setBrowse({ ...browse, dir })} onClose={() => setBrowse(null)}
          onRestore={(items) => setRestore({ version: browse.version, items })} onFileVersions={(rel) => setFileRel(rel)} />
      )}

      <FileHistory job={job} seq={seq} rel={fileRel} setRel={setFileRel} onRestore={(version, rel) => setRestore({ version, items: [rel] })} />

      <section className="home-section" aria-labelledby="bk-activity-h">
        <div className="section-head"><h2 id="bk-activity-h">Activity</h2></div>
        {!activity.length ? <p className="muted small">Nothing yet.</p> : (
          <ul className="backup-activity" aria-label={`Activity of ${job.name}`}>
            {activity.map((a) => (
              <li key={a.id} className={`backup-activity-row is-${a.level}`}>
                <Icon name={a.level === 'success' ? 'success' : a.level === 'error' ? 'error' : a.level === 'warning' ? 'warning' : 'info'} size={14} />
                <span className="tabular muted backup-activity-when">{formatDate(a.ms)}</span>
                <span className="backup-activity-msg">{a.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {restore && <RestoreDialog job={job} version={restore.version} items={restore.items} onClose={() => setRestore(null)} onRestore={(t) => void doRestore(t)} />}
    </>
  );
}

function VerifyPanel({ verify, paused, onClose }: { verify: { version: string; jobId?: string; progress?: { done: number; total: number }; result?: VerifyResult; error?: string }; paused: boolean; onClose: () => void }) {
  const r = verify.result;
  const bad = r ? r.mismatched.length + r.missing.length : 0;
  return (
    <div className={`backup-verify ${r ? (bad ? 'is-bad' : 'is-ok') : ''}`} role="status" aria-live="polite">
      <div className="backup-verify-head">
        <Icon name={r ? (bad ? 'error' : 'success') : 'shield'} size={16} />
        <strong>{r ? (bad ? `Version ${r.version}: ${bad} file(s) damaged or missing` : `Version ${r.version} verified: all ${r.checked.toLocaleString()} files match`) : verify.error ? `Verify ${verify.version}: ${verify.error}` : `Verifying ${verify.version}…`}</strong>
        <span className="spacer" />
        {verify.jobId && <JobPauseButton jobId={verify.jobId} size="sm" />}
        {!verify.jobId && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
      </div>
      {verify.jobId && <ProgressBar label="Verify progress" value={verify.progress?.total ? verify.progress.done / verify.progress.total : undefined} tone={paused ? 'warning' : 'accent'} />}
      {r && bad > 0 && (
        <ul className="op-failures small">
          {r.mismatched.slice(0, 30).map((p) => <li key={p}><span className="mono">{p}</span> — contents differ from the manifest</li>)}
          {r.missing.slice(0, 30).map((p) => <li key={p}><span className="mono">{p}</span> — the stored copy is missing</li>)}
        </ul>
      )}
      {r && <p className="muted small">Every file was read and compared with the SHA-256 in the manifest{r.sizeOnly ? ` (${r.sizeOnly} without a recorded SHA-256 were checked by size)` : ''}.</p>}
    </div>
  );
}

function VersionBrowser({ job, version, dir, onDir, onClose, onRestore, onFileVersions }: { job: BackupJob; version: string; dir: string; onDir: (d: string) => void; onClose: () => void; onRestore: (items: string[]) => void; onFileVersions: (rel: string) => void }) {
  const [data, setData] = useState<{ entries: BrowseEntry[]; truncated: boolean; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setData(null);
    setChecked(new Set());
    call<{ entries: BrowseEntry[]; truncated: boolean; total: number }>('backup:browse', { id: job.id, version, dir }).then((d) => {
      setData(d);
      setError(null);
    }, (err) => setError(errorShape(err).message));
  }, [job.id, version, dir]);
  const crumbs = useMemo(() => {
    const parts = dir ? dir.split('/') : [];
    return [{ label: version, rel: '' }, ...parts.map((p, i) => ({ label: p, rel: parts.slice(0, i + 1).join('/') }))];
  }, [dir, version]);
  const toggle = (rel: string) => {
    const n = new Set(checked);
    if (n.has(rel)) n.delete(rel);
    else n.add(rel);
    setChecked(n);
  };
  const sel = [...checked];
  const oneFile = sel.length === 1 && data?.entries.find((e) => e.rel === sel[0])?.kind === 'file' ? sel[0] : undefined;
  const allChecked = !!data?.entries.length && data.entries.every((e) => checked.has(e.rel));
  return (
    <section className="home-section backup-browser" aria-labelledby="bk-browse-h">
      <div className="section-head">
        <h2 id="bk-browse-h">Browse version {version}</h2>
        <span className="muted small">Read-only</span>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <nav className="archive-crumbs backup-crumbs" aria-label="Folder in this version">
        {crumbs.map((c, i) => (
          <React.Fragment key={c.rel || '/'}>
            {i > 0 && <Icon name="chevronRight" size={12} className="crumb-sep" />}
            <button type="button" className="crumb" aria-current={i === crumbs.length - 1 ? 'location' : undefined} onClick={() => onDir(c.rel)}>{c.label}</button>
          </React.Fragment>
        ))}
      </nav>
      <div className="selection-bar backup-select-bar">
        <span>{sel.length ? `${formatCount(sel.length, 'item')} selected` : 'Select items to restore'}</span>
        <span className="spacer" />
        <Button size="sm" icon="fileVersions" disabled={!oneFile} title={oneFile ? undefined : 'Select one file.'} onClick={() => oneFile && onFileVersions(oneFile)}>Versions of this file</Button>
        <Button size="sm" variant="primary" icon="restore" disabled={!sel.length} onClick={() => onRestore(sel)}>Restore…</Button>
      </div>
      {error ? <ErrorState title="This folder could not be read from the backup" body={error} />
        : !data ? <Loading label="Reading the version" />
          : !data.entries.length ? <p className="muted small">This folder is empty in this version.</p>
            : (
              <div className="backup-table-wrap">
                <table className="table backup-files" aria-label={`Items in ${dir || version}`}>
                  <thead>
                    <tr>
                      <th scope="col" className="bk-col-check"><input type="checkbox" aria-label="Select all items in this folder" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(data.entries.map((e) => e.rel)))} /></th>
                      <th scope="col">Name</th><th scope="col" className="num bk-col-size">Size</th><th scope="col" className="bk-col-date">Modified</th><th scope="col">Since previous</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.rel} className={checked.has(e.rel) ? 'is-selected' : ''} data-rel={e.rel}>
                        <td className="bk-col-check"><input type="checkbox" aria-label={`Select ${e.name}`} checked={checked.has(e.rel)} onChange={() => toggle(e.rel)} /></td>
                        <td className="backup-file-name">
                          <FileIcon entry={{ kind: e.kind, ext: extOf(e.name) }} size={15} />
                          {e.kind === 'directory'
                            ? <button type="button" className="link-button" onClick={() => onDir(e.rel)} aria-label={`Open folder ${e.name}`}>{e.name}</button>
                            : <span className="ellipsis" title={e.kind === 'symlink' ? `${e.name} → ${e.linkTarget}` : e.name}>{e.name}{e.kind === 'symlink' ? ` → ${e.linkTarget}` : ''}</span>}
                        </td>
                        <td className="num tabular bk-col-size">{e.kind === 'file' ? formatBytes(e.size) : e.kind === 'directory' ? formatCount(e.items ?? 0, 'item') : ''}</td>
                        <td className="tabular bk-col-date">{formatDate(e.mtimeMs)}</td>
                        <td>{e.status && <span className={`backup-status is-${e.status}`}>{e.status === 'new' ? 'New' : e.status === 'changed' ? 'Changed' : 'Unchanged'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.truncated && <p className="muted small">Showing the first {data.entries.length.toLocaleString()} of {data.total.toLocaleString()} items. Restore the folder to get all of them.</p>}
              </div>
            )}
    </section>
  );
}

function FileHistory({ job, seq, rel, setRel, onRestore }: { job: BackupJob; seq: number; rel: string | null; setRel: (r: string | null) => void; onRestore: (version: string, rel: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Array<{ rel: string; versions: number; latest: string; size?: number }> | null>(null);
  const [rows, setRows] = useState<FileVersionRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!rel) {
      setRows(null);
      return;
    }
    call<FileVersionRow[]>('backup:fileVersions', { id: job.id, rel }).then(setRows, toastError);
  }, [job.id, rel, seq]);
  const search = () => {
    if (!query.trim()) return;
    setSearching(true);
    call<typeof hits>('backup:search', { id: job.id, query }).then((h) => setHits(h), toastError).finally(() => setSearching(false));
  };
  return (
    <section className="home-section backup-history" aria-labelledby="bk-history-h">
      <div className="section-head"><h2 id="bk-history-h">Find a file in every version</h2></div>
      <form className="backup-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <TextField id="bk-search" label="Name or part of a path" value={query} placeholder="report.docx" onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" icon="search" disabled={!query.trim() || searching}>Search versions</Button>
      </form>
      {hits && (!hits.length ? <p className="muted small">No file in any complete version matches “{query}”.</p> : (
        <ul className="backup-hits" aria-label="Files found in the versions">
          {hits.map((h) => (
            <li key={h.rel}>
              <button type="button" className={`backup-hit ${rel === h.rel ? 'is-current' : ''}`} aria-pressed={rel === h.rel} onClick={() => setRel(h.rel)}>
                <FileIcon entry={{ kind: 'file', ext: extOf(h.rel) }} size={15} />
                <span className="mono ellipsis">{h.rel}</span>
                <span className="muted small tabular">{formatCount(h.versions, 'version')}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
      {rel && (
        <div className="backup-file-versions">
          <div className="backup-file-versions-head">
            <Icon name="fileVersions" size={16} />
            <strong className="mono">{rel}</strong>
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => setRel(null)}>Close</Button>
          </div>
          {!rows ? <Loading label="Reading versions" /> : (
            <table className="table backup-file-rows" aria-label={`Versions of ${rel}`}>
              <thead><tr><th scope="col">Version</th><th scope="col" className="num">Size</th><th scope="col" className="bk-col-date">Modified</th><th scope="col">Since previous</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.version} data-version={r.version} className={r.present ? '' : 'is-missing'}>
                    <td><div className="tabular">{formatDate(r.startedMs)}</div><div className="mono muted small">{r.version}</div></td>
                    <td className="num tabular">{r.present ? formatBytes(r.size) : '—'}</td>
                    <td className="tabular bk-col-date">{r.present ? formatDate(r.mtimeMs) : 'Not in this version'}</td>
                    <td>{r.status && <span className={`backup-status is-${r.status}`}>{r.status === 'new' ? 'New' : r.status === 'changed' ? 'Changed' : 'Unchanged'}</span>}</td>
                    <td className="row-actions">{r.present && <Button size="sm" icon="restore" onClick={() => onRestore(r.version, rel)} aria-label={`Restore ${rel} from ${r.version}`}>Restore…</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
