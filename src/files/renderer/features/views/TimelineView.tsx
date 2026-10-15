import { useEffect, useMemo, useRef, useState } from 'react';
import { call, on, runJob, type JobHandle } from '../../api';
import { app, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, EmptyState, FileIcon, Loading, Pill, Segmented, Select } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { categoryOfEntry, formatBytes, type Category } from '../../ui/format';
import { openFile } from '../../actions';
import { JobPauseButton, showInPane } from './common';
import { groupByDay, PERIOD_MS, type TimelineEntry, type TimelinePeriod, type TimelineResult } from '../../../shared/timeline';

/**
 * Recent changes: files created or modified in the last day, week or month
 * across chosen folders (default: your user folders), grouped by day. Answered
 * from the search index where it covers a folder, otherwise by a bounded live
 * scan (pausable, cancellable). Updates while open when the folders change.
 */

type TypeFilter = 'all' | 'image' | 'video' | 'audio' | 'documents' | 'code' | 'archive' | 'other';
const TYPE_OF: Record<Category, TypeFilter> = {
  image: 'image', video: 'video', audio: 'audio', document: 'documents', pdf: 'documents', spreadsheet: 'documents', presentation: 'documents', text: 'documents',
  code: 'code', archive: 'archive', executable: 'other', other: 'other', link: 'other', folder: 'other',
};
const PREFS_KEY = 'orbis.timeline';
const PAGE = 300;

interface Prefs { period: TimelinePeriod; folders: string[] | null }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return { period: raw?.period && raw.period in PERIOD_MS ? raw.period : 'week', folders: Array.isArray(raw?.folders) && raw.folders.length ? raw.folders.filter((f): f is string => typeof f === 'string').slice(0, 64) : null };
  } catch {
    return { period: 'week', folders: null };
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* per-window convenience only */
  }
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function TimelineView() {
  const known = useStore(app, (s) => s.known);
  const defaults = useMemo(() => known.filter((k) => ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'].includes(k.id)).map((k) => k.path), [known]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const folders = prefs.folders ?? defaults;
  const [result, setResult] = useState<TimelineResult | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [progress, setProgress] = useState<{ checked: number; found: number; folder: string } | null>(null);
  const [job, setJob] = useState<JobHandle<TimelineResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<TypeFilter>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [shown, setShown] = useState(PAGE);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sinceRef = useRef(0);

  const update = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    savePrefs(next);
  };

  const run = () => {
    if (!folders.length) return;
    job?.cancel();
    const since = Date.now() - PERIOD_MS[prefs.period];
    sinceRef.current = since;
    setNow(Date.now());
    setError(null);
    setProgress(null);
    setShown(PAGE);
    const h = runJob<TimelineResult>((jobId) => call('timeline:query', { jobId, folders, sinceMs: since, useIndex: true, showHidden: app.get().settings.showHidden }), (p) => setProgress(p as typeof progress), 'Recent changes');
    setJob(h);
    void h.promise.then((r) => {
      setJob(null);
      if (r.cancelled || !r.value) return;
      setResult(r.value);
      setEntries(r.value.entries);
    }, (err) => {
      setJob(null);
      setError((err as Error).message);
    });
    // Keep the list current while the view is open.
    void call<{ watching: boolean; capped: boolean }>('timeline:watch', { folders, sinceMs: since }).then((w) => setLive(w.watching), () => setLive(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, [prefs.period, folders.join('\n')]);
  useEffect(() => () => {
    void call('timeline:unwatch').catch(() => undefined);
  }, []);
  useEffect(() => () => job?.cancel(), [job]);
  useEffect(() => on<{ entries: TimelineEntry[]; removed: string[] }>('timeline:changed', (u) => {
    setNow(Date.now());
    setEntries((cur) => {
      const gone = new Set([...u.removed, ...u.entries.map((e) => e.path)]);
      const kept = cur.filter((e) => !gone.has(e.path));
      return [...u.entries.filter((e) => e.atMs >= sinceRef.current), ...kept].sort((a, b) => b.atMs - a.atMs);
    });
  }), []);

  const filtered = useMemo(() => entries.filter((e) => (type === 'all' || TYPE_OF[categoryOfEntry({ kind: 'file', ext: e.ext })] === type) && (folderFilter === 'all' || e.folder === folderFilter)), [entries, type, folderFilter]);
  const groups = useMemo(() => groupByDay(filtered.slice(0, shown), now), [filtered, shown, now]);

  const addFolder = async () => {
    const p = await call<string | null>('fs:pickDirectory', { title: 'Add a folder to Recent changes' }).catch(() => null);
    if (p && !folders.includes(p)) update({ folders: [...folders, p].slice(0, 64) });
  };
  const removeFolder = (f: string) => {
    const next = folders.filter((x) => x !== f);
    update({ folders: next.length ? next : null });
    if (folderFilter === f) setFolderFilter('all');
  };

  return (
    <div className="tool-view scroll-y timeline-view">
      <header className="view-header">
        <h1>Recent changes</h1>
        <p className="muted">Files created or modified recently in your folders, newest first. Folders in the search index are answered from it (each item checked on disk); others are scanned with limits.</p>
      </header>
      <div className="timeline-controls">
        <Segmented<TimelinePeriod> label="Period" value={prefs.period} onChange={(period) => update({ period })}
          options={[{ value: 'day', label: 'Last day' }, { value: 'week', label: 'Last week' }, { value: 'month', label: 'Last month' }]} />
        <Select<TypeFilter> id="tl-type" label="Type" value={type} onChange={setType}
          options={[{ value: 'all', label: 'All types' }, { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }, { value: 'audio', label: 'Audio' }, { value: 'documents', label: 'Documents' }, { value: 'code', label: 'Code' }, { value: 'archive', label: 'Archives' }, { value: 'other', label: 'Other' }]} />
        <Select<string> id="tl-folder" label="Folder" value={folderFilter} onChange={setFolderFilter}
          options={[{ value: 'all', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: base(f) }))]} />
        <div className="timeline-run">
          {job ? (
            <>
              <JobPauseButton jobId={job.jobId} size="sm" />
              <Button size="sm" icon="stop" onClick={() => job.cancel()}>Stop</Button>
            </>
          ) : <Button size="sm" icon="refresh" onClick={run}>Refresh</Button>}
        </div>
      </div>
      <div className="timeline-folders" role="group" aria-label="Folders included">
        {folders.map((f) => (
          <span key={f} className="timeline-chip" title={f}>
            <Icon name="folder" size={13} />
            <span className="ellipsis">{base(f)}</span>
            <button type="button" className="timeline-chip-x" aria-label={`Remove ${f} from Recent changes`} onClick={() => removeFolder(f)}><Icon name="close" size={12} /></button>
          </span>
        ))}
        <Button size="sm" variant="ghost" icon="plus" onClick={() => void addFolder()}>Add folder…</Button>
        {prefs.folders && <Button size="sm" variant="ghost" onClick={() => update({ folders: null })}>Use my user folders</Button>}
      </div>
      <div className="timeline-status small muted" aria-live="polite">
        {job ? <span>Looking for changes{progress ? ` · ${progress.checked.toLocaleString()} checked · ${progress.found.toLocaleString()} found · ${base(progress.folder)}` : '…'}</span>
          : result ? (
            <span>
              {filtered.length.toLocaleString()} file{filtered.length === 1 ? '' : 's'}{filtered.length !== entries.length ? ` shown of ${entries.length.toLocaleString()}` : ''}
              {result.truncated ? ' (only the most recent are listed)' : ''}
              {' · '}{result.sources.map((s) => `${base(s.folder)}: ${s.via === 'index' ? 'search index' : 'scanned'}`).join(', ')}
              {live && ' · updates live'}
            </span>
          ) : null}
        {result?.sources.filter((s) => s.note).map((s) => <span key={s.folder} className="warning-text">{base(s.folder)}: {s.note}</span>)}
      </div>
      {error ? <EmptyState icon="warning" title="Recent changes could not be listed" body={error} />
        : !folders.length ? <EmptyState icon="folder" title="No folders chosen" body="Add a folder to see what changed in it." />
          : !result && job ? <Loading label="Looking for recent changes…" />
            : result && !filtered.length ? <EmptyState icon="timeline" title="No changes in this period" body={entries.length ? 'Nothing matches the filters.' : 'No files were created or modified here in this period.'} />
              : (
                <div className="timeline">
                  {groups.map((g) => (
                    <section key={g.key} className="timeline-day" aria-labelledby={`tl-${g.key}`}>
                      <h2 id={`tl-${g.key}`} className="timeline-day-head">{g.label} <span className="muted small">{g.entries.length}</span></h2>
                      <ul className="timeline-list">
                        {g.entries.map((e) => <TimelineRow key={e.path} e={e} />)}
                      </ul>
                    </section>
                  ))}
                  {filtered.length > shown && <Button onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</Button>}
                </div>
              )}
    </div>
  );
}

function TimelineRow({ e }: { e: TimelineEntry }) {
  const rel = e.dir === e.folder ? base(e.folder) : `${base(e.folder)}/${e.dir.slice(e.folder.length + 1).split(/[\\/]/).join('/')}`;
  return (
    <li className="timeline-row" onDoubleClick={() => void openFile(e.path)}>
      <span className="timeline-time tabular">{timeFmt.format(e.atMs)}</span>
      <FileIcon entry={{ kind: 'file', ext: e.ext }} size={18} />
      <span className="timeline-main">
        <span className="timeline-name ellipsis" title={e.path}>{e.name}</span>
        <span className="timeline-where mono small muted ellipsis" title={e.dir}>{rel}</span>
      </span>
      <span className="timeline-meta">
        <Pill tone={e.event === 'created' ? 'accent' : 'neutral'}>{e.event === 'created' ? 'New' : 'Modified'}</Pill>
        <span className="tabular small muted">{formatBytes(e.size)}</span>
      </span>
      <span className="timeline-actions">
        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Open ${e.name}`} onClick={() => void openFile(e.path)}>Open</button>
        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Show ${e.name} selected in its folder`} onClick={() => showInPane(e.path)}>Select</button>
        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Reveal ${e.name} in the system file manager`} onClick={() => void call('fs:reveal', { path: e.path }).catch(toastError)}>Reveal</button>
      </span>
    </li>
  );
}
