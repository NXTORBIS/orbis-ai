import { useEffect, useMemo, useRef, useState } from 'react';
import { call, errorShape, runJob } from '../../api';
import { app, confirm, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane } from '../../state/workspace';
import { findPrefill } from '../../state/docTools';
import { canUndo, openFile, startOperation, undoOperation, undoLabel } from '../../actions';
import { Button, EmptyState, ErrorState, Pill, ProgressBar, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatCount } from '../../ui/format';
import { FolderPicker, JobPauseButton, showInPane, useJobPaused } from './common';
import { buildMatcher, expandReplacement, usesContextTokens, FIND_MAX_FILE_BYTES, type FileMatches, type FindQuery, type FindReport, type MatchInfo, type ReplacePreview } from '../../../shared/findReplace';
import { splitPatterns } from '../../../shared/glob';
import { TERMINAL_STATES, type OperationRecord } from '../../../shared/operations';

/**
 * Find and replace in files: search a folder's text files (a pausable
 * background job), review the matches grouped by file with their lines,
 * preview each file's change as a diff, then replace the chosen matches as
 * one 'find-replace' operation (snapshots first; Undo restores them).
 */

const FILES_STEP = 100;
const MAX_MB = `${FIND_MAX_FILE_BYTES / 1024 / 1024} MB`;
const ENC_LABEL: Record<FileMatches['encoding'], string> = { utf8: 'UTF-8', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', latin1: 'Latin-1', windows1252: 'Windows-1252' };
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

interface Kept {
  root: string; findText: string; replaceText: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean;
  includeText: string; excludeText: string; skipHidden: boolean; report: FindReport | null; reportKey: string;
  chosen: Record<string, Set<number>>; opId: string | null; seq: number;
}
/** The view's state per pane, so a layout change (which can re-create the view) keeps the search and its results. */
const kept = new Map<string, Kept>();

export function FindReplaceView({ paneId }: { paneId: string }) {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const prefill = useStore(findPrefill, (s) => s);
  const init = kept.get(paneId);
  const startDir = (() => {
    const l = activePane().history[activePane().index];
    return l?.kind === 'fs' ? l.path : home;
  })();
  const fresh = !init && prefill.paneId === paneId && prefill.root;
  const [root, setRoot] = useState(init?.root ?? (fresh ? prefill.root! : startDir));
  const applied = useRef(init?.seq ?? prefill.seq);
  useEffect(() => {
    // "Find and replace in files…" run again for this pane: start from its folder.
    if (prefill.seq === applied.current || prefill.paneId !== paneId) return;
    applied.current = prefill.seq;
    if (prefill.root) setRoot(prefill.root);
  }, [prefill.seq, prefill.root, prefill.paneId, paneId]);
  const [findText, setFindText] = useState(init?.findText ?? '');
  const [replaceText, setReplaceText] = useState(init?.replaceText ?? '');
  const [regex, setRegex] = useState(init?.regex ?? false);
  const [caseSensitive, setCaseSensitive] = useState(init?.caseSensitive ?? false);
  const [wholeWord, setWholeWord] = useState(init?.wholeWord ?? false);
  const [includeText, setIncludeText] = useState(init?.includeText ?? '');
  const [excludeText, setExcludeText] = useState(init?.excludeText ?? '.git/, node_modules/');
  const [skipHidden, setSkipHidden] = useState(init?.skipHidden ?? true);
  const [report, setReport] = useState<FindReport | null>(init?.report ?? null);
  const [reportKey, setReportKey] = useState(init?.reportKey ?? '');
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  const [progress, setProgress] = useState<{ files: number; matches: number; current?: string } | null>(null);
  const [error, setError] = useState<{ message: string; errorId?: string } | null>(null);
  const [chosen, setChosen] = useState<Record<string, Set<number>>>(init?.chosen ?? {});
  const [diffs, setDiffs] = useState<Record<string, ReplacePreview | 'loading'>>({});
  const [opId, setOpId] = useState<string | null>(init?.opId ?? null);
  const op = useStore(app, (s) => (opId ? s.ops[opId] : undefined));
  useEffect(() => {
    kept.set(paneId, { root, findText, replaceText, regex, caseSensitive, wholeWord, includeText, excludeText, skipHidden, report, reportKey, chosen, opId, seq: applied.current });
  }, [paneId, root, findText, replaceText, regex, caseSensitive, wholeWord, includeText, excludeText, skipHidden, report, reportKey, chosen, opId]);
  // A search still running when the view goes away is stopped (its results would have nowhere to go).
  const jobRef = useRef(job);
  jobRef.current = job;
  useEffect(() => () => jobRef.current?.cancel(), []);

  const query: FindQuery = { text: findText, regex, caseSensitive, wholeWord };
  const matcher = findText ? buildMatcher(query) : undefined;
  const key = JSON.stringify({ root, query, includeText, excludeText, skipHidden });
  const outdated = !!report && key !== reportKey;

  const search = () => {
    if (!matcher?.ok) return;
    setReport(null);
    setError(null);
    setDiffs({});
    setOpId(null);
    setProgress({ files: 0, matches: 0 });
    const req = { root, query, include: splitPatterns(includeText), exclude: splitPatterns(excludeText), skipHidden };
    const k = key;
    const j = runJob<FindReport>((jobId) => call('find:search', { ...req, jobId }), (p) => setProgress(p as typeof progress), `Find in ${baseName(root)}`);
    setJob({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then(
      (r) => {
        setJob(null);
        setProgress(null);
        if (r.value) {
          setReport(r.value);
          setReportKey(k);
          setChosen(Object.fromEntries(r.value.files.map((f) => [f.path, new Set(f.matches.map((m) => m.i))])));
        }
      },
      (err) => {
        setJob(null);
        setProgress(null);
        const e = errorShape(err);
        setError({ message: e.message, errorId: e.errorId });
      },
    );
  };

  const files = report?.files ?? [];
  const selectedFiles = files.filter((f) => (chosen[f.path]?.size ?? 0) > 0);
  const selectedCount = selectedFiles.reduce((n, f) => n + chosen[f.path]!.size, 0);
  const listed = files.reduce((n, f) => n + f.matches.length, 0);

  const loadDiffs = async (paths: string[]) => {
    const want = files.filter((f) => paths.includes(f.path) && chosen[f.path]?.size).slice(0, 50);
    if (!want.length) return;
    setDiffs((d) => ({ ...d, ...Object.fromEntries(want.map((f) => [f.path, 'loading' as const])) }));
    try {
      const r = await call<ReplacePreview[]>('find:preview', { query, replacement: replaceText, files: want.map((f) => ({ path: f.path, sha256: f.sha256, matches: [...chosen[f.path]!] })) });
      setDiffs((d) => ({ ...d, ...Object.fromEntries(r.map((x) => [x.path, x])) }));
    } catch (err) {
      setDiffs((d) => Object.fromEntries(Object.entries(d).filter(([p]) => !want.some((f) => f.path === p))));
      toastError(err, 'The preview could not be made');
    }
  };

  const replace = async () => {
    if (!selectedFiles.length || outdated) return;
    const ok = await confirm({
      title: `Replace ${formatCount(selectedCount, 'match', 'matches')} in ${formatCount(selectedFiles.length, 'file')}?`,
      body: `${replaceText ? `They are replaced with “${replaceText.length > 60 ? `${replaceText.slice(0, 60)}…` : replaceText}”.` : 'They are deleted (the replacement is empty).'} Each file is saved as a snapshot first and must not have changed since the search; Undo restores the snapshots.`,
      confirmLabel: 'Replace',
      detail: selectedFiles.slice(0, 8).map((f) => `${f.rel}: ${formatCount(chosen[f.path]!.size, 'match', 'matches')}`),
    });
    if (!ok) return;
    const params = { query, replacement: replaceText, files: selectedFiles.map((f) => ({ path: f.path, sha256: f.sha256, matches: [...chosen[f.path]!].sort((a, b) => a - b) })) };
    const rec = await startOperation({ type: 'find-replace', sources: params.files.map((f) => f.path), params, origin: 'find-replace' });
    if (rec) setOpId(rec.id);
  };

  const toggleFile = (f: FileMatches, on: boolean) => setChosen((c) => ({ ...c, [f.path]: new Set(on ? f.matches.map((m) => m.i) : []) }));
  const toggleMatch = (f: FileMatches, i: number, on: boolean) => setChosen((c) => {
    const s = new Set(c[f.path]);
    if (on) s.add(i);
    else s.delete(i);
    return { ...c, [f.path]: s };
  });
  const setAll = (on: boolean) => setChosen(Object.fromEntries(files.map((f) => [f.path, new Set(on ? f.matches.map((m) => m.i) : [])])));

  return (
    <div className="tool-view scroll-y find-view">
      <header className="view-header">
        <h1>Find and replace in files</h1>
        <p className="muted">Searches the text files in a folder (binary files and files over {MAX_MB} are skipped). Nothing changes until you choose Replace; each changed file is saved as a snapshot first.</p>
      </header>

      <section className="tool-options find-options" aria-label="What to find">
        <FolderPicker value={root} onChange={setRoot} label="Folder" id="find-root" />
        <form className="find-fields" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <TextField id="find-text" label="Find" mono value={findText} onChange={(e) => setFindText(e.target.value)} placeholder={regex ? 'Regular expression, e.g. (\\d{4})-(\\d{2})' : 'Text to find'} error={findText && matcher && !matcher.ok ? matcher.error : undefined} />
          <TextField id="find-replace" label="Replace with" mono value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="(empty: delete the matches)" hint={regex ? '$1, $2… and $<name> insert captured groups; $& the whole match; $$ a dollar sign.' : undefined} />
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
        <div className="find-flags" role="group" aria-label="Match options">
          <FlagButton icon="regex" label="Regular expression" on={regex} set={setRegex} />
          <FlagButton icon="caseSensitive" label="Match case" on={caseSensitive} set={setCaseSensitive} />
          <FlagButton icon="wholeWord" label="Whole word" on={wholeWord} set={setWholeWord} />
          <label className="check"><input type="checkbox" checked={skipHidden} onChange={(e) => setSkipHidden(e.target.checked)} /> Skip hidden items</label>
        </div>
        <div className="tool-controls two">
          <TextField id="find-include" label="Files to include" mono placeholder="*.md, src/**/*.ts" value={includeText} onChange={(e) => setIncludeText(e.target.value)} hint="Empty: every text file." />
          <TextField id="find-exclude" label="Files and folders to exclude" mono value={excludeText} onChange={(e) => setExcludeText(e.target.value)} hint="Patterns separated by commas." />
        </div>
        <div className="find-actions">
          {job ? (
            <>
              <JobPauseButton jobId={job.jobId} />
              <Button onClick={job.cancel}>Stop</Button>
            </>
          ) : (
            <Button variant="primary" icon="search" disabled={!matcher?.ok || !root} onClick={search}>Search</Button>
          )}
          {!findText && <span className="muted small">Enter text to find.</span>}
        </div>
      </section>

      {progress && (
        <div className="tool-progress" role="status">
          <ProgressBar label="Searching" tone={paused ? 'warning' : 'accent'} />
          <span className="tabular small">{paused ? 'Paused · ' : ''}{formatCount(progress.files, 'file')} searched · {formatCount(progress.matches, 'match', 'matches')}{progress.current ? ` · ${progress.current}` : ''}</span>
        </div>
      )}
      {error && <ErrorState title="The search could not be run" body={error.message} errorId={error.errorId} />}
      {op && <ReplaceResult op={op} onSearchAgain={search} />}
      {report && !op && (
        <section className="find-results" aria-labelledby="find-results-h">
          <div className="section-head"><h2 id="find-results-h">Results</h2><span className="muted small mono">{report.root}</span></div>
          <p className="small tabular" role="status">
            {formatCount(report.totalMatches, 'match', 'matches')} in {formatCount(files.length, 'file')} · {formatCount(report.filesSearched, 'file')} searched
            {report.skipped.binary ? ` · ${report.skipped.binary} binary skipped` : ''}
            {report.skipped.tooLarge ? ` · ${report.skipped.tooLarge} over ${MAX_MB} skipped` : ''}
            {report.skipped.links ? ` · ${report.skipped.links} links not followed` : ''}
            {report.skipped.unreadable ? ` · ${report.skipped.unreadable} unreadable` : ''}
            {report.skipped.excluded ? ` · ${report.skipped.excluded} excluded` : ''}
          </p>
          {report.limitReached && <p className="warning-text small">The search stopped at {report.totalMatches.toLocaleString()} matches. Narrow it down to see the rest.</p>}
          {report.partial && !report.limitReached && <p className="warning-text small">The search was stopped; only part of the folder was searched.</p>}
          {report.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
          {outdated && <div className="callout warning" role="status"><Icon name="warning" size={16} /><span>The folder, text or options changed after this search. Search again before replacing.</span></div>}
          {!files.length ? <EmptyState icon="search" title="No matches" body="Nothing in the searched files matches." /> : (
            <>
              <FileList files={files} chosen={chosen} replaceText={replaceText} regex={regex} diffs={diffs} onToggleFile={toggleFile} onToggleMatch={toggleMatch} onDiff={(p) => void loadDiffs([p])} onHideDiff={(p) => setDiffs((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== p)))} />
              <div className="selection-bar sticky-bottom find-bar">
                <span className="tabular">{formatCount(selectedCount, 'match', 'matches')} of {listed.toLocaleString()} in {formatCount(selectedFiles.length, 'file')} chosen</span>
                <span className="spacer" />
                <span className="bar-actions">
                  <Button size="sm" variant="ghost" onClick={() => setAll(true)}>All</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAll(false)}>None</Button>
                  <Button size="sm" icon="diff" disabled={!selectedFiles.length || outdated} onClick={() => void loadDiffs(selectedFiles.map((f) => f.path))}>Preview changes{selectedFiles.length > 50 ? ' (first 50 files)' : ''}</Button>
                  <Button size="sm" variant="primary" icon="replace" disabled={!selectedFiles.length || outdated} onClick={() => void replace()}>Replace…</Button>
                </span>
              </div>
            </>
          )}
        </section>
      )}
      {!report && !progress && !error && !op && <EmptyState icon="replace" title="Search a folder" body="Choose a folder, enter text to find and press Search. Matches are listed by file before anything is replaced." />}
    </div>
  );
}

function FlagButton({ icon, label, on, set }: { icon: string; label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" className={`btn btn-default btn-sm find-flag ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set(!on)}>
      <Icon name={icon} size={14} /><span>{label}</span>
    </button>
  );
}

function FileList({ files, chosen, replaceText, regex, diffs, onToggleFile, onToggleMatch, onDiff, onHideDiff }: {
  files: FileMatches[]; chosen: Record<string, Set<number>>; replaceText: string; regex: boolean; diffs: Record<string, ReplacePreview | 'loading'>;
  onToggleFile: (f: FileMatches, on: boolean) => void; onToggleMatch: (f: FileMatches, i: number, on: boolean) => void; onDiff: (p: string) => void; onHideDiff: (p: string) => void;
}) {
  const [limit, setLimit] = useState(FILES_STEP);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const contextTokens = regex && usesContextTokens(replaceText);
  return (
    <div className="find-files">
      {files.slice(0, limit).map((f, fi) => {
        const sel = chosen[f.path] ?? new Set<number>();
        const open = !collapsed.has(f.path);
        const d = diffs[f.path];
        const headId = `find-file-${fi}`;
        return (
          <section key={f.path} className="find-file" aria-labelledby={headId}>
            <div className="find-file-head">
              <input type="checkbox" aria-label={`Replace in ${f.rel}`} checked={sel.size > 0} ref={(el) => { if (el) el.indeterminate = sel.size > 0 && sel.size < f.matches.length; }} onChange={(e) => onToggleFile(f, e.target.checked)} />
              <button type="button" id={headId} className="find-file-toggle" aria-expanded={open} onClick={() => setCollapsed((c) => { const n = new Set(c); if (open) n.add(f.path); else n.delete(f.path); return n; })}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                <span className="mono find-file-name">{f.rel}</span>
              </button>
              <Pill tone="accent">{f.total.toLocaleString()}</Pill>
              {f.encoding !== 'utf8' || f.bom ? <Pill>{ENC_LABEL[f.encoding]}{f.bom ? ' BOM' : ''}</Pill> : null}
              <span className="spacer" />
              <span className="find-file-actions">
                <Button size="sm" variant="ghost" aria-label={`Open ${f.rel}`} onClick={() => void openFile(f.path)}>Open</Button>
                <Button size="sm" variant="ghost" aria-label={`Show ${f.rel} in its folder`} onClick={() => showInPane(f.path)}>Show</Button>
                {d && d !== 'loading' ? <Button size="sm" onClick={() => onHideDiff(f.path)} aria-label={`Hide the changes to ${f.rel}`}>Hide changes</Button> : <Button size="sm" icon="diff" disabled={!sel.size || d === 'loading'} onClick={() => onDiff(f.path)} aria-label={`Show the changes to ${f.rel}`}>Changes</Button>}
              </span>
            </div>
            {f.truncated && <p className="muted small find-note">{f.matches.length.toLocaleString()} of {f.total.toLocaleString()} matches are listed; only listed matches can be replaced.</p>}
            {open && (
              <ul className="find-matches" aria-label={`Matches in ${f.rel}`}>
                {f.matches.map((m) => <MatchRow key={m.i} m={m} on={sel.has(m.i)} replaceText={replaceText} regex={regex} contextTokens={contextTokens} rel={f.rel} onToggle={(on) => onToggleMatch(f, m.i, on)} />)}
              </ul>
            )}
            {d === 'loading' && <p className="muted small find-note" role="status">Preparing the changes…</p>}
            {d && d !== 'loading' && <DiffView d={d} rel={f.rel} />}
          </section>
        );
      })}
      {files.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + FILES_STEP * 5)}>Show more files ({(files.length - limit).toLocaleString()} more)</Button>}
    </div>
  );
}

function MatchRow({ m, on, replaceText, regex, contextTokens, rel, onToggle }: { m: MatchInfo; on: boolean; replaceText: string; regex: boolean; contextTokens: boolean; rel: string; onToggle: (on: boolean) => void }) {
  const replacement = useMemo(() => {
    if (regex && (contextTokens || (!m.captures.length && /\$[1-9<]/.test(replaceText)))) return undefined;
    return expandReplacement(replaceText, { index: 0, text: m.text, captures: m.captures, groups: m.groups }, regex);
  }, [m, replaceText, regex, contextTokens]);
  const before = m.lineText.slice(0, m.start);
  const hit = m.lineText.slice(m.start, m.end);
  const after = m.lineText.slice(m.end);
  return (
    <li className={`find-match ${on ? '' : 'is-off'}`}>
      <label className="find-match-check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className="sr-only">Replace the match in {rel}, line {m.line}, column {m.column}</span>
      </label>
      <span className="find-line tabular" aria-hidden>{m.line}</span>
      <code className="find-text">
        {before}
        <del className="find-hit">{hit}{m.multiline ? '…' : ''}</del>
        {replacement === undefined ? <ins className="find-new is-unknown" title="Shown in the change preview">(see changes)</ins> : replacement ? <ins className="find-new">{replacement}</ins> : null}
        {after}
      </code>
    </li>
  );
}

function DiffView({ d, rel }: { d: ReplacePreview; rel: string }) {
  if (!d.ok) return <div className="callout warning find-note" role="alert"><Icon name="warning" size={16} /><span>{d.problem}</span></div>;
  return (
    <div className="find-diff" role="region" aria-label={`Changes to ${rel}: ${formatCount(d.replaced, 'replacement')}`}>
      {d.lines.map((l, i) => l.kind === 'gap' ? (
        <div key={i} className="diff-line is-gap" aria-hidden>⋯</div>
      ) : (
        <div key={i} className={`diff-line is-${l.kind}`}>
          <span className="diff-no tabular" aria-hidden>{l.oldLine ?? ''}</span>
          <span className="diff-no tabular" aria-hidden>{l.newLine ?? ''}</span>
          <span className="diff-sign" aria-hidden>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          <span className="diff-text"><span className="sr-only">{l.kind === 'add' ? 'Added: ' : l.kind === 'del' ? 'Removed: ' : ''}</span>{l.text || ' '}</span>
        </div>
      ))}
      {d.clipped && <div className="diff-line is-gap">The rest of the changes are not shown here.</div>}
    </div>
  );
}

function ReplaceResult({ op, onSearchAgain }: { op: OperationRecord; onSearchAgain: () => void }) {
  const done = TERMINAL_STATES.has(op.state);
  const s = op.summary;
  const tone = op.state === 'completed' ? 'success' : op.state === 'failed' || op.state === 'interrupted' ? 'error' : done ? 'warning' : 'accent';
  const failures = op.results.filter((r) => r.status === 'failed');
  return (
    <section className="sync-result" aria-live="polite" aria-label="Replacement result">
      <div className="sync-result-head">
        <strong>{done ? (op.state === 'completed' ? 'Replaced' : op.state === 'completed_with_errors' ? 'Finished with errors' : op.state === 'cancelled' ? 'Cancelled' : 'Failed') : 'Replacing…'}</strong>
        <Pill tone={tone}>{op.state.replace(/_/g, ' ')}</Pill>
        <span className="spacer" />
        {done && canUndo(op) && <Button size="sm" icon="undo" onClick={() => void undoOperation(op.id)}>{undoLabel(op)}</Button>}
        {done && op.undoneMs && <Pill>Undone</Pill>}
        {done && <Button size="sm" variant="primary" onClick={onSearchAgain}>Search again</Button>}
      </div>
      {!done && <ProgressBar label="Replacement progress" value={op.progress.totalItems ? op.progress.completedItems / op.progress.totalItems : undefined} />}
      {done && s && <p className="tabular small">{formatCount(s.done, 'file')} changed{s.skipped ? ` · ${s.skipped} skipped` : ''}{s.failed ? ` · ${s.failed} failed` : ''}</p>}
      {op.notes?.map((n) => <p key={n} className="muted small">{n}</p>)}
      {failures.length > 0 && (
        <ul className="op-failures small">
          {failures.slice(0, 50).map((f) => <li key={f.source}><span className="mono">{f.source}</span> — {f.error?.message}</li>)}
        </ul>
      )}
    </section>
  );
}
