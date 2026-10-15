import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { call, runJob } from '../../api';
import { app, confirm, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { navigate, activePane } from '../../state/workspace';
import { EmptyState, ErrorState, ProgressBar, Pill, SortHeader, Tabs, tabId } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatCount, formatDay } from '../../ui/format';
import { startOperation } from '../../actions';
import { FileRowActions, FolderPicker, JobPauseButton, onOperationFinished, useJobPaused, useStickyHead } from './common';

interface TreeNode { name: string; path: string; bytes: number; files: number; children?: TreeNode[]; truncated?: number }
interface FileRow { path: string; bytes: number; modifiedMs: number }
type JunkCategory = 'temporary' | 'system' | 'cache' | 'backup';
interface JunkItem extends FileRow { kind: 'file' | 'directory'; category: JunkCategory; pattern: string }
interface Report {
  root: string; complete: boolean; cancelled: boolean; limitReached: boolean; maxEntries: number; entries: number;
  bytes: number; files: number; directories: number; symlinksSkipped: number; unreadable: number;
  byCategory: Array<{ category: string; bytes: number; files: number }>;
  byExtension: Array<{ ext: string; bytes: number; files: number }>; extensionsTruncated: number;
  largestFiles: FileRow[]; oldMonths: number; oldFiles: FileRow[]; oldTotals: { files: number; bytes: number };
  archives: FileRow[]; largestFolders: Array<{ path: string; bytes: number; files: number }>;
  emptyDirs: Array<{ path: string; nested: number }>; brokenLinks: Array<{ path: string; target: string; reason: 'missing' | 'loop' }>;
  junk: JunkItem[]; junkTotals: Record<JunkCategory, { items: number; bytes: number }>;
  tree: TreeNode; volume?: { totalBytes: number; freeBytes: number }; scannedMs: number;
}
interface HistoryPoint { id: string; ms: number; bytes: number; files: number; complete: boolean }
type Tab = 'map' | 'cleanup' | 'largest' | 'folders' | 'old' | 'types' | 'empty' | 'links' | 'archives' | 'history';

const CAT_COLOR: Record<string, string> = {
  image: 'var(--hue-image)', video: 'var(--hue-video)', audio: 'var(--hue-audio)', document: 'var(--hue-doc)', spreadsheet: 'var(--hue-code)', presentation: 'var(--hue-audio)',
  archive: 'var(--hue-archive)', code: 'var(--hue-code)', text: 'var(--hue-doc)', other: 'var(--hue-other)', folder: 'var(--hue-folder)',
};

/** Shown in the Cleanup panel; mirrors JUNK_PATTERNS in main/tools/storage.ts. */
const JUNK_INFO: Record<JunkCategory, { label: string; note: string }> = {
  temporary: { label: 'Temporary and incomplete files', note: 'Left by editors, office programs and interrupted downloads (*.tmp, ~$*, *.part, *.crdownload…). A program that is still running may be using some.' },
  system: { label: 'Folder view files', note: '.DS_Store and Thumbs.db: icon positions and thumbnails that macOS and Windows recreate when needed.' },
  cache: { label: 'Build and tool caches', note: 'node_modules/.cache, __pycache__, .pytest_cache and similar; tools rebuild them, the next run may be slower.' },
  backup: { label: 'Backup copies', note: '*.bak and name~ copies written by editors. Check that you do not need the older version.' },
};

const AGE_OPTIONS = [3, 6, 12, 24, 36, 60];
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function StorageView() {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const [root, setRoot] = useState(() => {
    const loc = activePane().history.find((l) => l.kind === 'fs');
    return loc?.kind === 'fs' ? loc.path : home;
  });
  const [oldMonths, setOldMonths] = useState(12);
  const [progress, setProgress] = useState<{ files: number; bytes: number; entries?: number; current: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  const [focus, setFocus] = useState<TreeNode[]>([]);
  const [tab, setTab] = useState<Tab>('map');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const loadHistory = (r: string) => void call<HistoryPoint[]>('storage:history', { root: r }).then(setHistory, () => setHistory([]));

  const scan = () => {
    setReport(null);
    setError(null);
    setFocus([]);
    setProgress({ files: 0, bytes: 0, current: root });
    const j = runJob<Report>((jobId) => call('tool:storageScan', { path: root, jobId, oldMonths }), (p) => setProgress(p as typeof progress), `Storage analysis · ${baseName(root)}`);
    setJob({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then(
      (r) => {
        setJob(null);
        setProgress(null);
        if (r.value) {
          setReport(r.value);
          loadHistory(r.value.root);
        }
      },
      (err) => {
        setJob(null);
        setProgress(null);
        setError((err as Error).message);
      },
    );
  };

  /** Move items to the Trash (one operation, after confirmation); drop them from the lists once done. */
  const trash = async (paths: string[], what: string, body: string): Promise<boolean> => {
    if (!paths.length) return false;
    const ok = await confirm({ title: `Move ${formatCount(paths.length, what)} to the Trash?`, body: `${body} You can restore them from the Trash.`, confirmLabel: 'Move to Trash', destructive: true, detail: paths.slice(0, 8) });
    if (!ok) return false;
    const rec = await startOperation({ type: 'trash', sources: paths, origin: 'storage-cleanup' });
    if (!rec) return false;
    onOperationFinished(rec.id, (done) => {
      const gone = new Set(done.results.filter((r) => r.status === 'done').map((r) => r.source));
      if (!gone.size) return;
      const keep = <T extends { path: string }>(l: T[]) => l.filter((x) => !gone.has(x.path));
      setReport((r) => r && { ...r, largestFiles: keep(r.largestFiles), oldFiles: keep(r.oldFiles), archives: keep(r.archives), emptyDirs: keep(r.emptyDirs), brokenLinks: keep(r.brokenLinks), junk: keep(r.junk) });
    });
    return true;
  };

  const node = focus[focus.length - 1] ?? report?.tree;
  const junkBytes = report ? Object.values(report.junkTotals).reduce((a, t) => a + t.bytes, 0) : 0;

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Storage analysis</h1>
        <p className="muted">Scans a folder on this computer and shows where space is used. Links are not followed, and nothing is deleted unless you choose it and confirm.</p>
      </header>
      <div className="tool-controls">
        <FolderPicker value={root} onChange={setRoot} label="Folder to analyse" />
        <label className="field narrow">
          <span className="field-label">Old means not modified for</span>
          <select className="input" value={oldMonths} onChange={(e) => setOldMonths(Number(e.target.value))}>
            {AGE_OPTIONS.map((m) => <option key={m} value={m}>{m < 12 ? `${m} months` : m === 12 ? '1 year' : `${m / 12} years`}</option>)}
          </select>
        </label>
        {job ? <><JobPauseButton jobId={job.jobId} /><button type="button" className="btn btn-default btn-md" onClick={job.cancel}>Stop scan</button></> : <button type="button" className="btn btn-primary btn-md" onClick={scan}>Analyse</button>}
      </div>
      {progress && (
        <div className="tool-progress" role="status" aria-live="polite">
          <ProgressBar label="Scanning" tone={paused ? 'warning' : 'accent'} />
          <span className="tabular">{paused ? 'Paused · ' : ''}{formatCount(progress.files, 'file')} · {formatBytes(progress.bytes)} so far</span>
          <span className="mono muted ellipsis">{progress.current}</span>
        </div>
      )}
      {error && <ErrorState title="The scan failed" body={error} />}
      {!report && !progress && !error && <EmptyState icon="storage" title="Choose a folder and select Analyse" body="Large folders can take a while. You can pause, stop, or keep working while the scan runs." />}
      {report && (
        <>
          <div className="stat-strip">
            <Stat label="Total size" value={formatBytes(report.bytes)} />
            <Stat label="Files" value={report.files.toLocaleString()} />
            <Stat label="Folders" value={report.directories.toLocaleString()} />
            {report.volume && <Stat label="Free on this drive" value={`${formatBytes(report.volume.freeBytes)} of ${formatBytes(report.volume.totalBytes)}`} />}
            <div className="stat-flags">
              {report.complete ? <Pill tone="success">Complete scan</Pill> : <Pill tone="warning">{report.cancelled ? 'Stopped early — partial results' : report.limitReached ? `Stopped at ${report.maxEntries.toLocaleString()} items — partial` : 'Partial results'}</Pill>}
              {report.unreadable > 0 && <Pill tone="warning">{report.unreadable} unreadable</Pill>}
              {report.symlinksSkipped > 0 && <Pill>{formatCount(report.symlinksSkipped, 'link')} not followed</Pill>}
            </div>
          </div>

          <div className="cat-bar" role="img" aria-label={`Space by file type: ${report.byCategory.filter((c) => c.bytes > 0).map((c) => `${c.category} ${formatBytes(c.bytes)}`).join(', ')}`}>
            {report.byCategory.filter((c) => c.bytes > 0).map((c) => (
              <span key={c.category} style={{ flexGrow: c.bytes, background: CAT_COLOR[c.category] ?? CAT_COLOR.other }} title={`${c.category}: ${formatBytes(c.bytes)} in ${formatCount(c.files, 'file')}`} />
            ))}
          </div>
          <div className="cat-legend">
            {report.byCategory.filter((c) => c.bytes > 0).map((c) => (
              <span key={c.category}><i style={{ background: CAT_COLOR[c.category] ?? CAT_COLOR.other }} />{c.category} <span className="muted tabular">{formatBytes(c.bytes)}</span></span>
            ))}
          </div>

          <Tabs<Tab> idPrefix="storage" label="Storage results" value={tab} onChange={setTab} tabs={[
            { value: 'map', label: 'Treemap' },
            { value: 'cleanup', label: `Cleanup (${formatBytes(junkBytes)})` },
            { value: 'largest', label: `Largest files (${report.largestFiles.length})` },
            { value: 'folders', label: 'Largest folders' },
            { value: 'old', label: `Old files (${report.oldTotals.files.toLocaleString()})` },
            { value: 'types', label: `By type (${report.byExtension.length})` },
            { value: 'empty', label: `Empty folders (${report.emptyDirs.length})` },
            { value: 'links', label: `Broken links (${report.brokenLinks.length})` },
            { value: 'archives', label: `Archives (${report.archives.length})` },
            { value: 'history', label: `History (${history.length})` },
          ]} />

          <div role="tabpanel" id="storage-panel" aria-labelledby={tabId('storage', tab)} className="storage-panel">
            {tab === 'map' && node && (
              <>
                <div className="archive-crumbs">
                  <button type="button" className="crumb" onClick={() => setFocus([])}>{report.tree.name}</button>
                  {focus.map((f, i) => (
                    <React.Fragment key={f.path}>
                      <Icon name="chevronRight" size={12} className="crumb-sep" />
                      <button type="button" className="crumb" onClick={() => setFocus(focus.slice(0, i + 1))}>{f.name}</button>
                    </React.Fragment>
                  ))}
                  <span className="spacer" />
                  <button type="button" className="link-btn" onClick={() => void navigate(activePane().id, { kind: 'fs', path: node.path })}>Open this folder</button>
                </div>
                <Treemap node={node} onDrill={(n) => (n.children?.length ? setFocus([...focus, n]) : void navigate(activePane().id, { kind: 'fs', path: parentOf(n.path) }, { select: n.path }))} />
                {node.truncated ? <p className="muted small">{node.truncated} smaller items in this folder are included in its total but not drawn.</p> : null}
              </>
            )}
            {tab === 'cleanup' && <CleanupPanel report={report} onTrash={trash} />}
            {tab === 'largest' && (
              <FileTable rows={report.largestFiles} what="file" caption="The 100 largest files" note="Large is not the same as unneeded. Review each file before acting." onTrash={trash} />
            )}
            {tab === 'old' && (
              <>
                <p className="muted small">{report.oldTotals.files.toLocaleString()} files ({formatBytes(report.oldTotals.bytes)}) were not modified for {report.oldMonths < 12 ? `${report.oldMonths} months` : report.oldMonths === 12 ? 'a year' : `${report.oldMonths / 12} years`}. Shown: the largest and the oldest of them. Change “Old means” and analyse again for another age.</p>
                <FileTable rows={report.oldFiles} what="file" caption="Files not modified recently" initialSort={{ key: 'modified', dir: 'asc' }} note="Old is not the same as unneeded: archives, photos and records are often old on purpose." onTrash={trash} />
              </>
            )}
            {tab === 'archives' && <FileTable rows={report.archives} what="archive" caption="Archive files" note="An archive may be the only copy of what it contains." onTrash={trash} />}
            {tab === 'folders' && <FolderTable rows={report.largestFolders} />}
            {tab === 'types' && <ExtensionTable rows={report.byExtension} total={report.bytes} truncated={report.extensionsTruncated} />}
            {tab === 'empty' && <EmptyFolders rows={report.emptyDirs} partial={!report.complete} onTrash={trash} />}
            {tab === 'links' && <BrokenLinks rows={report.brokenLinks} onTrash={trash} />}
            {tab === 'history' && <StorageHistory points={history} onClear={async () => {
              if (await confirm({ title: 'Clear the measurement history for this folder?', body: 'Only the recorded totals are removed. No files are affected.', confirmLabel: 'Clear history' })) await call('storage:clearHistory', { root: report.root }).then(() => setHistory([]), toastError);
            }} />}
          </div>
        </>
      )}
    </div>
  );
}

function parentOf(p: string): string {
  const i = p.replace(/[\\/]+$/, '').lastIndexOf(p.includes('\\') ? '\\' : '/');
  return i <= 0 ? p.slice(0, 1) : p.slice(0, i);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value tabular">{value}</span>
    </div>
  );
}

type TrashFn = (paths: string[], what: string, body: string) => Promise<boolean>;

/* ---------------------------------------------------------------- selection helpers */

function useSelection(paths: string[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Forget selected items that left the list (e.g. moved to the Trash).
  const live = useMemo(() => new Set([...sel].filter((p) => paths.includes(p))), [sel, paths]);
  const toggle = (p: string, on: boolean) => {
    const n = new Set(live);
    if (on) n.add(p);
    else n.delete(p);
    setSel(n);
  };
  const all = paths.length > 0 && paths.every((p) => live.has(p));
  return { sel: live, toggle, setAll: (on: boolean) => setSel(on ? new Set(paths) : new Set()), all, some: live.size > 0 && !all, clear: () => setSel(new Set()) };
}

function SelectAll({ all, some, onChange, label }: { all: boolean; some: boolean; onChange: (on: boolean) => void; label: string }) {
  return <input type="checkbox" aria-label={label} checked={all} ref={(el) => { if (el) el.indeterminate = some; }} onChange={(e) => onChange(e.target.checked)} />;
}

/* ---------------------------------------------------------------- tables */

type FileSortKey = 'name' | 'bytes' | 'modified';

function FileTable({ rows, what, caption, note, onTrash, initialSort = { key: 'bytes', dir: 'desc' } }: { rows: FileRow[]; what: string; caption: string; note: string; onTrash: TrashFn; initialSort?: { key: FileSortKey; dir: 'asc' | 'desc' } }) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    const k = sort.key;
    const d = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => d * (k === 'bytes' ? a.bytes - b.bytes : k === 'modified' ? a.modifiedMs - b.modifiedMs : baseName(a.path).localeCompare(baseName(b.path))));
  }, [rows, sort]);
  const s = useSelection(useMemo(() => rows.map((r) => r.path), [rows]));
  const stickyBar = useStickyHead();
  if (!rows.length) return <EmptyState icon="file" title="Nothing to show" />;
  const selBytes = rows.filter((r) => s.sel.has(r.path)).reduce((a, r) => a + r.bytes, 0);
  return (
    <>
      <p className="muted small">{note}</p>
      <div ref={stickyBar} className="selection-bar sticky" role="region" aria-label="Selected items">
        <span>{s.sel.size ? `${formatCount(s.sel.size, what)} selected · ${formatBytes(selBytes)}` : `Select ${what}s to act on them.`}</span>
        <button type="button" className="btn btn-danger btn-sm" disabled={!s.sel.size} onClick={async () => { if (await onTrash([...s.sel], what, 'They were chosen from a size or age list only; make sure you no longer need them.')) s.clear(); }}><Icon name="trash" size={14} /> <span>Move to Trash…</span></button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th style={{ width: 28 }}><SelectAll all={s.all} some={s.some} onChange={s.setAll} label={`Select all ${what}s`} /></th>
              <SortHeader label="Name" sortKey="name" sort={sort} onSort={setSort} />
              <SortHeader label="Size" sortKey="bytes" sort={sort} onSort={setSort} numeric />
              <SortHeader label="Modified" sortKey="modified" sort={sort} onSort={setSort} className="wide-only" />
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.path} className={s.sel.has(r.path) ? 'is-selected' : ''}>
                <td><input type="checkbox" aria-label={`Select ${r.path}`} checked={s.sel.has(r.path)} onChange={(e) => s.toggle(r.path, e.target.checked)} /></td>
                <td className="cell-path"><div>{baseName(r.path)}</div><div className="mono muted small">{r.path}</div><div className="cell-sub narrow-only">Modified {formatDay(r.modifiedMs)}</div></td>
                <td className="tabular num">{formatBytes(r.bytes)}</td>
                <td className="tabular wide-only">{formatDay(r.modifiedMs)}</td>
                <td className="row-actions"><FileRowActions path={r.path} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FolderTable({ rows }: { rows: Report['largestFolders'] }) {
  const [sort, setSort] = useState<{ key: 'name' | 'bytes' | 'files'; dir: 'asc' | 'desc' }>({ key: 'bytes', dir: 'desc' });
  const sorted = useMemo(() => {
    const d = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => d * (sort.key === 'bytes' ? a.bytes - b.bytes : sort.key === 'files' ? a.files - b.files : baseName(a.path).localeCompare(baseName(b.path))));
  }, [rows, sort]);
  if (!rows.length) return <EmptyState icon="folder" title="No subfolders" />;
  return (
    <div className="table-scroll">
      <table className="table">
        <caption className="sr-only">The 100 largest folders (sizes include everything inside)</caption>
        <thead><tr><SortHeader label="Folder" sortKey="name" sort={sort} onSort={setSort} /><SortHeader label="Size" sortKey="bytes" sort={sort} onSort={setSort} numeric /><SortHeader label="Files" sortKey="files" sort={sort} onSort={setSort} numeric /><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {sorted.map((f) => (
            <tr key={f.path}>
              <td className="cell-path"><div>{baseName(f.path)}</div><div className="mono muted small">{f.path}</div></td>
              <td className="tabular num">{formatBytes(f.bytes)}</td>
              <td className="tabular num">{f.files.toLocaleString()}</td>
              <td className="row-actions"><FileRowActions path={f.path} folder /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExtensionTable({ rows, total, truncated }: { rows: Report['byExtension']; total: number; truncated: number }) {
  const [sort, setSort] = useState<{ key: 'ext' | 'files' | 'bytes'; dir: 'asc' | 'desc' }>({ key: 'bytes', dir: 'desc' });
  const sorted = useMemo(() => {
    const d = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => d * (sort.key === 'bytes' ? a.bytes - b.bytes : sort.key === 'files' ? a.files - b.files : a.ext.localeCompare(b.ext)));
  }, [rows, sort]);
  if (!rows.length) return <EmptyState icon="file" title="No files" />;
  return (
    <>
      {truncated > 0 && <p className="muted small">{truncated} more extensions are counted in the totals but not listed.</p>}
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Files by extension</caption>
          <thead><tr><SortHeader label="Extension" sortKey="ext" sort={sort} onSort={setSort} /><SortHeader label="Files" sortKey="files" sort={sort} onSort={setSort} numeric /><SortHeader label="Size" sortKey="bytes" sort={sort} onSort={setSort} numeric /><th className="num col-share">Share</th></tr></thead>
          <tbody>
            {sorted.map((e) => {
              const share = total ? e.bytes / total : 0;
              return (
                <tr key={e.ext}>
                  <td className="mono">{e.ext === '' ? <span className="muted">(no extension)</span> : e.ext === '(other)' ? <span className="muted">(other)</span> : `.${e.ext}`}</td>
                  <td className="tabular num">{e.files.toLocaleString()}</td>
                  <td className="tabular num">{formatBytes(e.bytes)}</td>
                  <td className="num col-share"><span className="share"><span className="share-bar" aria-hidden="true"><i style={{ width: `${Math.max(1, share * 100)}%` }} /></span><span className="tabular">{(share * 100).toFixed(share < 0.01 ? 2 : 1)} %</span></span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EmptyFolders({ rows, partial, onTrash }: { rows: Report['emptyDirs']; partial: boolean; onTrash: TrashFn }) {
  const s = useSelection(useMemo(() => rows.map((r) => r.path), [rows]));
  const stickyBar = useStickyHead();
  if (!rows.length) return <EmptyState icon="folder" title="No empty folders" body={partial ? 'Empty folders are only listed after a complete scan.' : 'Folders that contain only other empty folders are listed here too.'} />;
  return (
    <>
      <p className="muted small">Folders with nothing in them, or only other empty folders. Only the topmost folder is listed; moving it to the Trash takes the empty folders inside with it. Some programs expect certain empty folders to exist.</p>
      <div ref={stickyBar} className="selection-bar sticky" role="region" aria-label="Selected items">
        <span>{s.sel.size ? `${formatCount(s.sel.size, 'folder')} selected` : 'Select folders to act on them.'}</span>
        <button type="button" className="btn btn-danger btn-sm" disabled={!s.sel.size} onClick={async () => { if (await onTrash([...s.sel], 'empty folder', 'They contain no files.')) s.clear(); }}><Icon name="trash" size={14} /> <span>Move to Trash…</span></button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Empty folders</caption>
          <thead><tr><th style={{ width: 28 }}><SelectAll all={s.all} some={s.some} onChange={s.setAll} label="Select all empty folders" /></th><th>Folder</th><th className="num">Empty folders inside</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.path} className={s.sel.has(d.path) ? 'is-selected' : ''}>
                <td><input type="checkbox" aria-label={`Select ${d.path}`} checked={s.sel.has(d.path)} onChange={(e) => s.toggle(d.path, e.target.checked)} /></td>
                <td className="cell-path mono">{d.path}</td>
                <td className="tabular num">{d.nested || '—'}</td>
                <td className="row-actions"><FileRowActions path={d.path} folder /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BrokenLinks({ rows, onTrash }: { rows: Report['brokenLinks']; onTrash: TrashFn }) {
  const s = useSelection(useMemo(() => rows.map((r) => r.path), [rows]));
  const stickyBar = useStickyHead();
  if (!rows.length) return <EmptyState icon="link" title="No broken links" body="Symbolic links whose target is missing would be listed here." />;
  return (
    <>
      <p className="muted small">Symbolic links that point to something that does not exist (or that point at each other in a loop). Moving a link to the Trash never touches what it pointed to. A link to a drive that is not connected right now also shows as broken.</p>
      <div ref={stickyBar} className="selection-bar sticky" role="region" aria-label="Selected items">
        <span>{s.sel.size ? `${formatCount(s.sel.size, 'link')} selected` : 'Select links to act on them.'}</span>
        <button type="button" className="btn btn-danger btn-sm" disabled={!s.sel.size} onClick={async () => { if (await onTrash([...s.sel], 'broken link', 'Only the links are moved.')) s.clear(); }}><Icon name="trash" size={14} /> <span>Move to Trash…</span></button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Broken symbolic links</caption>
          <thead><tr><th style={{ width: 28 }}><SelectAll all={s.all} some={s.some} onChange={s.setAll} label="Select all broken links" /></th><th>Link</th><th>Points to</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.path} className={s.sel.has(l.path) ? 'is-selected' : ''}>
                <td><input type="checkbox" aria-label={`Select ${l.path}`} checked={s.sel.has(l.path)} onChange={(e) => s.toggle(l.path, e.target.checked)} /></td>
                <td className="cell-path mono">{l.path}</td>
                <td className="cell-path mono">{l.target}{l.reason === 'loop' && <> <Pill tone="warning">loop</Pill></>}</td>
                <td className="row-actions"><button type="button" className="btn btn-ghost btn-sm" aria-label={`Show ${l.path} in its folder`} onClick={() => void navigate(activePane().id, { kind: 'fs', path: parentOf(l.path) }, { select: l.path })}>Show</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- cleanup */

function CleanupPanel({ report, onTrash }: { report: Report; onTrash: TrashFn }) {
  const [open, setOpen] = useState<JunkCategory | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const items = report.junk;
  const live = useMemo(() => new Set([...sel].filter((p) => items.some((i) => i.path === p))), [sel, items]);
  const selBytes = items.filter((i) => live.has(i.path)).reduce((a, i) => a + i.bytes, 0);
  const cats = (Object.keys(JUNK_INFO) as JunkCategory[]);
  const total = cats.reduce((a, c) => a + report.junkTotals[c].bytes, 0);
  const toggle = (p: string, on: boolean) => {
    const n = new Set(live);
    if (on) n.add(p);
    else n.delete(p);
    setSel(n);
  };
  return (
    <div className="cleanup">
      <p className="muted small">Suggestions found by well-known names only. Nothing is selected for you: open a category, review the items, select what you want to remove, and move it to the Trash. {report.complete ? '' : 'The scan was partial, so there may be more.'}</p>
      <div className="cleanup-grid">
        {cats.map((c) => {
          const t = report.junkTotals[c];
          return (
            <section key={c} className={`cleanup-card ${open === c ? 'is-open' : ''}`} aria-labelledby={`cl-${c}`}>
              <h3 id={`cl-${c}`}>{JUNK_INFO[c].label}</h3>
              <p className="cleanup-size tabular">{formatBytes(t.bytes)} <span className="muted">· {formatCount(t.items, 'item')}</span></p>
              <p className="muted small">{JUNK_INFO[c].note}</p>
              <button type="button" className="btn btn-default btn-sm" disabled={!t.items} aria-expanded={open === c} aria-controls="cleanup-review" onClick={() => setOpen(open === c ? null : c)}>{open === c ? 'Hide' : 'Review…'}</button>
            </section>
          );
        })}
        <section className="cleanup-card" aria-labelledby="cl-empty">
          <h3 id="cl-empty">Empty folders</h3>
          <p className="cleanup-size tabular">{formatCount(report.emptyDirs.length, 'folder')}</p>
          <p className="muted small">Take no space, but clutter. Review them under Empty folders.</p>
        </section>
        <section className="cleanup-card" aria-labelledby="cl-links">
          <h3 id="cl-links">Broken links</h3>
          <p className="cleanup-size tabular">{formatCount(report.brokenLinks.length, 'link')}</p>
          <p className="muted small">Links to missing items. Review them under Broken links.</p>
        </section>
      </div>
      <p className="muted small">Together the suggested items use {formatBytes(total)}. Old and large files are not counted here; review them in their own lists.</p>
      {open && (
        <div id="cleanup-review" className="cleanup-review">
          <h3>{JUNK_INFO[open].label}</h3>
          <JunkList items={items.filter((i) => i.category === open)} sel={live} onToggle={toggle} onAll={(on) => {
            const ids = items.filter((i) => i.category === open).map((i) => i.path);
            setSel(new Set(on ? [...live, ...ids] : [...live].filter((p) => !ids.includes(p))));
          }} />
          {report.junkTotals[open].items > items.filter((i) => i.category === open).length && <p className="muted small">Only the first {items.length.toLocaleString()} suggestions are listed.</p>}
        </div>
      )}
      <div className="selection-bar sticky-bottom">
        <span>{live.size ? `${formatCount(live.size, 'item')} selected for review · ${formatBytes(selBytes)}` : 'Nothing selected.'}</span>
        <button type="button" className="btn btn-danger btn-sm" disabled={!live.size} onClick={async () => { if (await onTrash([...live], 'item', 'They were suggested because of their names (temporary files, caches, view files, backups). Make sure no running program needs them.')) setSel(new Set()); }}><Icon name="trash" size={14} /> <span>Move selected to Trash…</span></button>
      </div>
    </div>
  );
}

function JunkList({ items, sel, onToggle, onAll }: { items: JunkItem[]; sel: Set<string>; onToggle: (p: string, on: boolean) => void; onAll: (on: boolean) => void }) {
  const all = items.length > 0 && items.every((i) => sel.has(i.path));
  const some = !all && items.some((i) => sel.has(i.path));
  return (
    <div className="table-scroll">
      <table className="table">
        <caption className="sr-only">Suggested items</caption>
        <thead><tr><th style={{ width: 28 }}><SelectAll all={all} some={some} onChange={onAll} label="Select every item in this category" /></th><th>Item</th><th className="wide-only">Matched</th><th className="num">Size</th><th className="wide-only">Modified</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.path} className={sel.has(i.path) ? 'is-selected' : ''}>
              <td><input type="checkbox" aria-label={`Select ${i.path}`} checked={sel.has(i.path)} onChange={(e) => onToggle(i.path, e.target.checked)} /></td>
              <td className="cell-path"><div>{baseName(i.path)}{i.kind === 'directory' ? '/' : ''}</div><div className="mono muted small">{i.path}</div><div className="cell-sub narrow-only">Matched <span className="mono">{i.pattern}</span> · modified {formatDay(i.modifiedMs)}</div></td>
              <td className="mono small wide-only">{i.pattern}</td>
              <td className="tabular num">{formatBytes(i.bytes)}</td>
              <td className="tabular wide-only">{formatDay(i.modifiedMs)}</td>
              <td className="row-actions"><FileRowActions path={i.path} folder={i.kind === 'directory'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- history */

function StorageHistory({ points, onClear }: { points: HistoryPoint[]; onClear: () => void }) {
  if (!points.length) return <EmptyState icon="trend" title="No measurements yet" body="Each completed analysis of this folder is recorded so you can see how it grows over time." />;
  const w = 640;
  const h = 160;
  const min = Math.min(...points.map((p) => p.bytes));
  const max = Math.max(...points.map((p) => p.bytes));
  const t0 = points[0]!.ms;
  const t1 = points[points.length - 1]!.ms;
  const x = (ms: number) => (t1 === t0 ? w / 2 : 40 + ((ms - t0) / (t1 - t0)) * (w - 60));
  const y = (b: number) => (max === min ? h / 2 : 16 + (1 - (b - min) / (max - min)) * (h - 40));
  const delta = points.length > 1 ? points[points.length - 1]!.bytes - points[0]!.bytes : 0;
  return (
    <div className="storage-history">
      <p>
        {points.length === 1 ? 'One measurement so far. Analyse this folder again later to see a trend.' : <>Since {formatDay(points[0]!.ms)}: <strong className="tabular">{delta >= 0 ? '+' : '−'}{formatBytes(Math.abs(delta))}</strong> across {points.length} measurements.</>}
        {points.some((p) => !p.complete) && <span className="muted"> Hollow points are partial scans.</span>}
      </p>
      {points.length > 1 && (
        <svg className="trend-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Folder size from ${formatBytes(points[0]!.bytes)} to ${formatBytes(points[points.length - 1]!.bytes)}`}>
          <line x1={40} x2={w - 20} y1={h - 24} y2={h - 24} className="axis" />
          <text x={4} y={y(max) + 4} className="label">{formatBytes(max)}</text>
          {max !== min && <text x={4} y={y(min) + 4} className="label">{formatBytes(min)}</text>}
          <polyline points={points.map((p) => `${x(p.ms)},${y(p.bytes)}`).join(' ')} className="line" />
          {points.map((p) => <circle key={p.id} cx={x(p.ms)} cy={y(p.bytes)} r={3.5} className={p.complete ? 'pt' : 'pt partial'}><title>{`${formatDay(p.ms)}: ${formatBytes(p.bytes)}`}</title></circle>)}
        </svg>
      )}
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Measured</th><th className="num">Size</th><th className="num">Change</th><th className="num wide-only">Files</th><th>Scan</th></tr></thead>
          <tbody>
            {[...points].reverse().map((p, i, arr) => {
              const prev = arr[i + 1];
              const d = prev ? p.bytes - prev.bytes : undefined;
              return (
                <tr key={p.id}>
                  <td className="tabular">{formatDay(p.ms)} {new Date(p.ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="tabular num">{formatBytes(p.bytes)}</td>
                  <td className="tabular num">{d === undefined ? '—' : `${d >= 0 ? '+' : '−'}${formatBytes(Math.abs(d))}`}</td>
                  <td className="tabular num wide-only">{p.files.toLocaleString()}</td>
                  <td>{p.complete ? 'complete' : <span className="warning-text">partial</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear history</button>
    </div>
  );
}

/* ---------------------------------------------------------------- squarified treemap */

interface Rect { x: number; y: number; w: number; h: number; node: TreeNode }

function squarify(nodes: TreeNode[], x: number, y: number, w: number, h: number): Rect[] {
  const total = nodes.reduce((a, n) => a + n.bytes, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  const items = nodes.filter((n) => n.bytes > 0).map((n) => ({ node: n, area: n.bytes * scale }));
  const out: Rect[] = [];
  let rx = x, ry = y, rw = w, rh = h;
  let row: typeof items = [];
  const worst = (r: typeof items, side: number) => {
    const s = r.reduce((a, i) => a + i.area, 0);
    const max = Math.max(...r.map((i) => i.area));
    const min = Math.min(...r.map((i) => i.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const layout = (r: typeof items) => {
    const s = r.reduce((a, i) => a + i.area, 0);
    if (rw >= rh) {
      const colW = s / rh;
      let cy = ry;
      for (const i of r) {
        const ih = i.area / colW;
        out.push({ x: rx, y: cy, w: colW, h: ih, node: i.node });
        cy += ih;
      }
      rx += colW;
      rw -= colW;
    } else {
      const rowH = s / rw;
      let cx = rx;
      for (const i of r) {
        const iw = i.area / rowH;
        out.push({ x: cx, y: ry, w: iw, h: rowH, node: i.node });
        cx += iw;
      }
      ry += rowH;
      rh -= rowH;
    }
  };
  for (const item of items) {
    const side = Math.min(rw, rh);
    if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      layout(row);
      row = [item];
    }
  }
  if (row.length) layout(row);
  return out;
}

function Treemap({ node, onDrill }: { node: TreeNode; onDrill: (n: TreeNode) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 420 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rects = useMemo(() => squarify((node.children ?? []).slice().sort((a, b) => b.bytes - a.bytes), 0, 0, size.w, size.h), [node, size]);
  if (!node.children?.length) return <EmptyState icon="folder" title="No breakdown available" body="This folder has no items, or it is beyond the drawn depth. Open it to see its contents." />;
  return (
    <div ref={ref} className="treemap" role="list" aria-label={`Space used in ${node.name}`}>
      {rects.map((r) => {
        const isDir = !!r.node.children || r.node.files > 1;
        const ext = r.node.name.includes('.') ? r.node.name.split('.').pop()!.toLowerCase() : '';
        return (
          <button
            key={r.node.path}
            type="button"
            role="listitem"
            className={`tm-cell ${isDir ? 'dir' : 'file'}`}
            style={{ left: r.x, top: r.y, width: Math.max(0, r.w - 2), height: Math.max(0, r.h - 2), '--tm': isDir ? 'var(--hue-folder)' : CAT_COLOR[extCat(ext)] ?? CAT_COLOR.other } as React.CSSProperties}
            title={`${r.node.path}\n${formatBytes(r.node.bytes)}${isDir ? ` · ${formatCount(r.node.files, 'file')}` : ''}`}
            aria-label={`${r.node.name}, ${formatBytes(r.node.bytes)}${isDir ? `, ${formatCount(r.node.files, 'file')}` : ''}`}
            onClick={() => onDrill(r.node)}
          >
            {r.w > 70 && r.h > 34 && (
              <>
                <span className="tm-name">{r.node.name}</span>
                <span className="tm-size tabular">{formatBytes(r.node.bytes)}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function extCat(ext: string): string {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'raw', 'svg', 'bmp', 'tif', 'tiff'].includes(ext)) return 'image';
  if (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (['zip', 'tar', 'gz', '7z', 'rar', 'xz', 'iso', 'dmg'].includes(ext)) return 'archive';
  if (['pdf', 'doc', 'docx', 'md', 'txt', 'odt'].includes(ext)) return 'document';
  return 'other';
}
