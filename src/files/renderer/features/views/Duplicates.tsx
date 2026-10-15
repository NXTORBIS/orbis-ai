import { useMemo, useState } from 'react';
import { call, platform, runJob } from '../../api';
import { app, confirm, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane } from '../../state/workspace';
import { EmptyState, ErrorState, Pill, ProgressBar, Segmented, Toggle } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatCount, formatDate } from '../../ui/format';
import { startOperation } from '../../actions';
import { FolderPicker, JobPauseButton, onOperationFinished, showInPane, useJobPaused } from './common';
import { SELECTION_RULE_LABELS, applySelectionRule, baseName, duplicatesCsv, planFromMarks, type DuplicateGroup, type SelectionRule } from '../../../shared/dedupe';
import { splitPatterns } from '../../../shared/glob';

interface DupReport {
  mode: 'content' | 'name-size';
  groups: DuplicateGroup[];
  scannedFiles: number;
  candidates: number;
  hashedBytes: number;
  complete: boolean;
  cancelled: boolean;
  limitReached: boolean;
  unreadable: number;
  reclaimableBytes: number;
  notes: string[];
}
type Progress = { stage: 'scanning' | 'comparing' | 'verifying'; done: number; total?: number };
type Marks = Record<string, Set<string>>;
type SortKey = 'wasted' | 'size' | 'copies' | 'name';

const MIN_SIZES = [1, 1024, 64 * 1024, 1024 * 1024, 10 * 1024 * 1024, 100 * 1024 * 1024];
const PAGE = 50;

const STAGE_TEXT: Record<Progress['stage'], string> = { scanning: 'Listing files', comparing: 'Comparing the start and end of files', verifying: 'Verifying full contents' };

export function ExactDuplicates() {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const [roots, setRoots] = useState<string[]>(() => {
    const l = activePane().history[activePane().index];
    return [l?.kind === 'fs' ? l.path : home];
  });
  const [minSize, setMinSize] = useState(1024);
  const [mode, setMode] = useState<'content' | 'name-size'>('content');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [skipHidden, setSkipHidden] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<DupReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  const [marks, setMarks] = useState<Marks>({});
  const [ruleNotes, setRuleNotes] = useState<Record<string, string>>({});
  const [rule, setRule] = useState<SelectionRule['kind']>('oldest');
  const [preferFolder, setPreferFolder] = useState(home);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('wasted');
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState<string | null>(null);

  const scan = () => {
    setReport(null);
    setError(null);
    setMarks({});
    setRuleNotes({});
    setShown(PAGE);
    setProgress({ stage: 'scanning', done: 0 });
    const label = roots.length === 1 ? roots[0]!.split(/[\\/]/).filter(Boolean).pop() ?? roots[0]! : `${roots.length} folders`;
    const j = runJob<DupReport>(
      (jobId) => call('tool:duplicates', { roots, jobId, minSize, mode, include: splitPatterns(include), exclude: splitPatterns(exclude), skipHidden }),
      (p) => setProgress(p as Progress),
      `Finding duplicates · ${label}`,
    );
    setJob({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then(
      (r) => {
        setJob(null);
        setProgress(null);
        if (r.value) setReport(r.value);
      },
      (err) => {
        setJob(null);
        setProgress(null);
        setError((err as Error).message);
      },
    );
  };

  const groups = useMemo(() => {
    if (!report) return [];
    const q = filter.trim().toLowerCase();
    const list = q ? report.groups.filter((g) => g.files.some((f) => f.path.toLowerCase().includes(q))) : report.groups.slice();
    const cmp: Record<SortKey, (a: DuplicateGroup, b: DuplicateGroup) => number> = {
      wasted: (a, b) => b.reclaimableBytes - a.reclaimableBytes,
      size: (a, b) => b.size - a.size,
      copies: (a, b) => b.files.length - a.files.length,
      name: (a, b) => baseName(a.files[0]!.path).localeCompare(baseName(b.files[0]!.path)),
    };
    return list.sort(cmp[sort]);
  }, [report, filter, sort]);

  const plan = useMemo(() => (report ? planFromMarks(report.groups, marks) : []), [report, marks]);
  const marked = plan.flatMap((g) => g.remove);
  const markedBytes = plan.reduce((a, g) => a + g.size * g.remove.length, 0);
  const totalCopies = report?.groups.reduce((a, g) => a + g.files.length, 0) ?? 0;

  const applyRule = () => {
    if (!report) return;
    const r: SelectionRule = rule === 'prefer-folder' ? { kind: rule, folder: preferFolder } : ({ kind: rule } as SelectionRule);
    // Rules apply to the groups shown (after filtering); other groups keep their marks.
    const visible = new Set(groups.map((g) => g.id));
    const res = applySelectionRule(report.groups.filter((g) => visible.has(g.id)), r);
    setMarks((m) => ({ ...m, ...Object.fromEntries(Object.entries(res.marks).map(([id, paths]) => [id, new Set(paths)])) }));
    setRuleNotes((n) => {
      const next = { ...n };
      for (const id of visible) delete next[id];
      return { ...next, ...res.notes };
    });
  };

  const toggle = (g: DuplicateGroup, p: string, on: boolean) => {
    const s = new Set(marks[g.id]);
    if (on) s.add(p);
    else s.delete(p);
    if (s.size >= g.files.length) return; // at least one copy is always kept
    setMarks({ ...marks, [g.id]: s });
  };

  /** After an action finishes, drop the copies it handled from the results (and groups left with one copy). */
  const watch = (id: string, label: string) => {
    setPending(label);
    onOperationFinished(id, (rec) => {
      setPending(null);
      const handled = new Set(rec.results.filter((r) => r.status === 'done').map((r) => r.source));
      if (!handled.size) return;
      setReport((rep) => {
        if (!rep) return rep;
        // Handled copies are gone (Trash, moved) or are now the same file as the kept copy (hard link).
        const next = rep.groups
          .map((g) => ({ ...g, files: g.files.filter((f) => !handled.has(f.path)) }))
          .filter((g) => g.files.length > 1)
          .map((g) => ({ ...g, reclaimableBytes: g.size * (g.files.length - 1) }));
        return { ...rep, groups: next, reclaimableBytes: next.reduce((a, g) => a + g.reclaimableBytes, 0) };
      });
      setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, new Set([...s].filter((p) => !handled.has(p)))])));
    });
  };

  const unverifiedNote = report?.mode === 'name-size' ? ' These groups were matched by name and size only; each copy is compared with the kept copy first and left alone if the contents differ.' : '';

  const trash = async () => {
    const ok = await confirm({
      title: `Move ${formatCount(marked.length, 'marked copy', 'marked copies')} to the Trash?`,
      body: `At least one copy of every group is kept. Each marked copy is checked against a kept copy right before it is moved, and you can restore it from the Trash. This frees about ${formatBytes(markedBytes)} once the Trash is emptied.${unverifiedNote}`,
      confirmLabel: 'Move to Trash',
      destructive: true,
      detail: marked.slice(0, 8),
    });
    if (!ok) return;
    const rec = await startOperation({ type: 'dedupe', sources: marked, params: { action: 'trash', groups: plan }, origin: 'duplicates' });
    if (rec) watch(rec.id, 'Moving marked copies to the Trash…');
  };

  const moveTo = async () => {
    const dest = await call<string | null>('fs:pickDirectory', { title: 'Move marked copies to' }).catch(() => null);
    if (!dest) return;
    const ok = await confirm({
      title: `Move ${formatCount(marked.length, 'marked copy', 'marked copies')} to ${dest.split(/[\\/]/).pop() || dest}?`,
      body: `They are moved into one folder (a number is added when names clash), after being checked against a kept copy. You can undo the move.${unverifiedNote}`,
      confirmLabel: 'Move',
      detail: marked.slice(0, 8),
    });
    if (!ok) return;
    const rec = await startOperation({ type: 'dedupe', sources: marked, destination: dest, params: { action: 'move', groups: plan }, origin: 'duplicates' });
    if (rec) watch(rec.id, 'Moving marked copies…');
  };

  const hardlink = async () => {
    const ok = await confirm({
      title: `Replace ${formatCount(marked.length, 'marked copy', 'marked copies')} with hard links?`,
      body: 'Each marked copy is replaced by a hard link to the kept copy of its group, so the data is stored once and every path still opens the same contents. Only copies on the same drive as the kept copy are linked, and only after their contents are compared again. Linked paths share one file: editing one changes all of them, and they take the kept copy\'s permissions and dates. This cannot be undone automatically.',
      confirmLabel: 'Replace with hard links',
      destructive: true,
      detail: marked.slice(0, 8),
    });
    if (!ok) return;
    const rec = await startOperation({ type: 'dedupe', sources: marked, params: { action: 'hardlink', groups: plan }, origin: 'duplicates' });
    if (rec) watch(rec.id, 'Replacing marked copies with hard links…');
  };

  const exportCsv = async () => {
    if (!report) return;
    try {
      const r = await call<{ path: string } | null>('tool:saveCsv', { suggestedName: 'duplicates', csv: duplicatesCsv(report.groups, marks) });
      if (r) toast({ level: 'success', title: 'Report saved', detail: r.path });
    } catch (err) {
      toastError(err, 'Could not save the report');
    }
  };

  const canHardlink = platform() !== 'win32';

  return (
    <>
      <p className="muted">Finds files with the same contents in one or more folders. Nothing is removed automatically: you mark copies (by hand or with a rule), review them, then choose what to do.</p>
      <section className="tool-options" aria-label="Search options">
        <div className="root-list">
          {roots.map((r, i) => (
            <div key={i} className="root-row">
              <FolderPicker id={`dup-root-${i}`} value={r} onChange={(v) => setRoots(roots.map((x, k) => (k === i ? v : x)))} label={roots.length > 1 ? `Folder ${i + 1}` : 'Folder to search'} />
              {roots.length > 1 && <button type="button" className="btn btn-ghost btn-md" aria-label={`Remove folder ${i + 1}`} onClick={() => setRoots(roots.filter((_, k) => k !== i))}><Icon name="close" size={14} /></button>}
            </div>
          ))}
          {roots.length < 16 && (
            <button type="button" className="btn btn-ghost btn-sm align-start" onClick={async () => {
              const p = await call<string | null>('fs:pickDirectory', { title: 'Add a folder to search' }).catch(() => null);
              if (p && !roots.includes(p)) setRoots([...roots, p]);
            }}><Icon name="plus" size={14} /> <span>Add another folder…</span></button>
          )}
        </div>
        <div className="tool-controls">
          <Segmented<'content' | 'name-size'> label="Match" value={mode} onChange={setMode} options={[{ value: 'content', label: 'Same content' }, { value: 'name-size', label: 'Same name and size (fast, not verified)' }]} />
          <label className="field narrow">
            <span className="field-label">Ignore files smaller than</span>
            <select className="input" value={minSize} onChange={(e) => setMinSize(Number(e.target.value))}>
              {MIN_SIZES.map((b) => <option key={b} value={b}>{b === 1 ? 'Nothing (all files)' : formatBytes(b)}</option>)}
            </select>
          </label>
        </div>
        <div className="tool-controls two">
          <label className="field">
            <span className="field-label">Only include</span>
            <input className="input mono" value={include} placeholder="*.jpg, *.png" spellCheck={false} aria-describedby="dup-glob-hint" onChange={(e) => setInclude(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Skip</span>
            <input className="input mono" value={exclude} placeholder="node_modules, *.tmp, Backups/**" spellCheck={false} aria-describedby="dup-glob-hint" onChange={(e) => setExclude(e.target.value)} />
          </label>
        </div>
        <p id="dup-glob-hint" className="muted small">Patterns separated by commas. A pattern without “/” matches names; with “/” it matches the path inside the searched folder (** = any folders).</p>
        <Toggle id="dup-hidden" label="Skip hidden files and folders" description="Names starting with a dot, such as .git or .cache." checked={skipHidden} onChange={setSkipHidden} />
        <div className="tool-controls">
          <span className="spacer" />
          {job ? <><JobPauseButton jobId={job.jobId} /><button type="button" className="btn btn-default btn-md" onClick={job.cancel}>Stop</button></> : <button type="button" className="btn btn-primary btn-md" disabled={!roots.length} onClick={scan}>Find duplicates</button>}
        </div>
      </section>

      {progress && (
        <div className="tool-progress" role="status" aria-live="polite">
          <ProgressBar label="Finding duplicates" value={progress.total ? progress.done / progress.total : undefined} tone={paused ? 'warning' : 'accent'} />
          <span className="tabular">{paused ? 'Paused · ' : ''}{STAGE_TEXT[progress.stage]} · {progress.total ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : formatCount(progress.done, 'file')}</span>
        </div>
      )}
      {error && <ErrorState title="The search failed" body={error} />}
      {!report && !progress && !error && <EmptyState icon="duplicates" title="Choose folders and select Find duplicates" body="Large folders take a while; you can pause, stop, or keep working meanwhile." />}

      {report && (
        <>
          <div className="stat-strip">
            <div className="stat"><span className="stat-label">Files checked</span><span className="stat-value tabular">{report.scannedFiles.toLocaleString()}</span></div>
            <div className="stat"><span className="stat-label">Groups</span><span className="stat-value tabular">{report.groups.length.toLocaleString()}</span></div>
            <div className="stat"><span className="stat-label">Extra copies</span><span className="stat-value tabular">{(totalCopies - report.groups.length).toLocaleString()}</span></div>
            <div className="stat"><span className="stat-label">Reclaimable</span><span className="stat-value tabular">{formatBytes(report.reclaimableBytes)}</span></div>
            <div className="stat-flags">
              {report.mode === 'name-size' && <Pill tone="warning">Not verified</Pill>}
              {report.complete ? <Pill tone="success">Complete</Pill> : <Pill tone="warning">{report.cancelled ? 'Stopped early' : report.limitReached ? 'File limit reached' : `${report.unreadable} unreadable items`}</Pill>}
            </div>
          </div>
          {report.mode === 'name-size' && (
            <div className="callout warning"><Icon name="warning" size={16} /><span>These groups share a name and size only. Their contents were not compared, so some may be different files. Every action compares each copy with the kept copy first and leaves it alone if they differ.</span></div>
          )}
          <ul className="dup-notes muted small">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {!report.groups.length ? <EmptyState icon="check" title="No duplicates found" body="Try a smaller minimum size or remove filters." /> : (
            <>
              <div className="tool-controls dup-toolbar">
                <label className="field">
                  <span className="field-label">Filter groups</span>
                  <input className="input" type="search" value={filter} placeholder="Part of a path or name" onChange={(e) => { setFilter(e.target.value); setShown(PAGE); }} />
                </label>
                <label className="field narrow">
                  <span className="field-label">Sort groups by</span>
                  <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    <option value="wasted">Wasted space</option>
                    <option value="size">File size</option>
                    <option value="copies">Number of copies</option>
                    <option value="name">Name</option>
                  </select>
                </label>
              </div>
              <div className="tool-controls dup-toolbar">
                <label className="field">
                  <span className="field-label">Mark copies with a rule</span>
                  <select className="input" value={rule} onChange={(e) => setRule(e.target.value as SelectionRule['kind'])}>
                    {(Object.keys(SELECTION_RULE_LABELS) as Array<SelectionRule['kind']>).map((k) => <option key={k} value={k}>{SELECTION_RULE_LABELS[k]}</option>)}
                  </select>
                </label>
                {rule === 'prefer-folder' && <FolderPicker id="dup-prefer" value={preferFolder} onChange={setPreferFolder} label="Keep the copy inside" />}
                <button type="button" className="btn btn-default btn-md" onClick={applyRule}>Mark {filter ? 'shown groups' : 'all groups'}</button>
                <button type="button" className="btn btn-ghost btn-md" disabled={!marked.length} onClick={() => { setMarks({}); setRuleNotes({}); }}>Clear marks</button>
              </div>
              <div className="selection-bar sticky" role="region" aria-label="Marked copies">
                <span aria-live="polite">{pending ?? (marked.length ? `${formatCount(marked.length, 'copy', 'copies')} marked · ${formatBytes(markedBytes)} · at least one copy of each group is kept` : 'Nothing marked yet. Tick copies or use a rule; the preview shows what each rule marks.')}</span>
                <div className="bar-actions">
                  <button type="button" className="btn btn-danger btn-sm" disabled={!marked.length || !!pending} onClick={() => void trash()}><Icon name="trash" size={14} /> <span>Move to Trash…</span></button>
                  <button type="button" className="btn btn-default btn-sm" disabled={!marked.length || !!pending} onClick={() => void moveTo()}><Icon name="moveTo" size={14} /> <span>Move to folder…</span></button>
                  {canHardlink && <button type="button" className="btn btn-default btn-sm" disabled={!marked.length || !!pending} onClick={() => void hardlink()}><Icon name="link" size={14} /> <span>Replace with hard links…</span></button>}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportCsv()}><Icon name="exportFile" size={14} /> <span>Export CSV…</span></button>
                </div>
              </div>
              {!canHardlink && <p className="muted small">Replacing copies with hard links is offered on Linux and macOS only.</p>}
              {!groups.length && <EmptyState icon="search" title="No group matches the filter" />}
              <div className="dup-list">
                {groups.slice(0, shown).map((g) => <DupGroupCard key={g.id} group={g} marked={marks[g.id]} note={ruleNotes[g.id]} onToggle={toggle} />)}
              </div>
              {groups.length > shown && (
                <button type="button" className="btn btn-default btn-md" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, groups.length - shown)} more of {groups.length - shown} remaining groups</button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function DupGroupCard({ group: g, marked, note, onToggle }: { group: DuplicateGroup; marked?: Set<string>; note?: string; onToggle: (g: DuplicateGroup, p: string, on: boolean) => void }) {
  const markedCount = marked?.size ?? 0;
  const headId = `dup-${g.id.replace(/[^a-z0-9]/gi, '').slice(0, 24)}-${g.size}`;
  return (
    <section className="dup-group" aria-labelledby={headId}>
      <div className="dup-head">
        <strong id={headId} className="ellipsis">{baseName(g.files[0]!.path)}</strong>
        <span className="muted tabular">{formatCount(g.files.length, 'copy', 'copies')} · {formatBytes(g.size)} each · {formatBytes(g.reclaimableBytes)} reclaimable</span>
        {g.verification === 'sha256' ? <Pill tone="success">Same content</Pill> : <Pill tone="warning">Name and size only</Pill>}
      </div>
      {note && <p className="dup-note muted small">{note}</p>}
      <ul className="dup-rows">
        {g.files.map((f) => {
          const isMarked = marked?.has(f.path) ?? false;
          const lastKept = !isMarked && g.files.length - markedCount === 1;
          return (
            <li key={f.path} className={`dup-row ${isMarked ? 'remove' : 'kept'}`}>
              <input
                type="checkbox"
                checked={isMarked}
                disabled={lastKept}
                aria-label={`Mark ${f.path}`}
                title={lastKept ? 'At least one copy is always kept.' : undefined}
                onChange={(e) => onToggle(g, f.path, e.target.checked)}
              />
              <span className="pill-inline">{isMarked ? 'Marked' : 'Keep'}</span>
              <span className="mono dup-path">{f.path}</span>
              <span className="muted tabular dup-date">{formatDate(f.modifiedMs)}</span>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Show ${f.path} in its folder`} onClick={() => showInPane(f.path)}>Show</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
