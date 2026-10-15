import { useEffect, useMemo, useState } from 'react';
import { call, runJob, type JobHandle } from '../api';
import { closeDialog } from '../state/app';
import { useStore } from '../state/store';
import { findPane, listingKeyFor, listings, navigate, setSelection } from '../state/workspace';
import { refreshTemplates, templates } from '../state/templates';
import { Button, Dialog, Pill, ProgressBar, Segmented, TextField } from '../ui/components';
import { formatBytes, formatCount, type Category } from '../ui/format';
import { combineSelection, matchingPaths, TYPE_CHOICES, type PatternMode, type SelectOp } from './selectPattern';
import { JobPauseButton, useJobPaused } from './views/common';
import { newFromTemplate } from '../actions';
import type { VerifyItem, VerifyStatus, VerifySummary } from '../../shared/checksumFile';

/* ---------------------------------------------------------------- select by pattern */

/** "Select by pattern…": wildcard, regular expression or type; shows the match count before selecting. */
export function SelectPatternDialog({ paneId }: { paneId: string }) {
  const found = findPane(paneId);
  const key = found ? listingKeyFor(found.tab.id, found.pane) : '';
  const listing = useStore(listings, (s) => s[key]);
  const filter = found?.pane.filter.trim().toLowerCase() ?? '';
  // Only items the pane shows (its quick filter applies), in listing order.
  const entries = useMemo(() => (listing?.entries ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter)), [listing?.entries, filter]);
  const [mode, setMode] = useState<PatternMode>('glob');
  const [pattern, setPattern] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeFolders, setIncludeFolders] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [op, setOp] = useState<SelectOp>('replace');
  const result = useMemo(() => matchingPaths(entries, { mode, pattern, caseSensitive, includeFolders, categories }), [entries, mode, pattern, caseSensitive, includeFolders, categories]);
  const current = found?.pane.selection ?? [];
  const next = result.ok ? combineSelection(entries, current, result.paths, op) : current;
  const apply = () => {
    if (!result.ok) return;
    setSelection(paneId, next, next[0], next[0]);
    closeDialog();
  };
  const touched = pattern.trim() !== '' || categories.length > 0;
  return (
    <Dialog title="Select by pattern" width={520} onClose={closeDialog} footer={
      <>
        <span className="grow muted small" role="status" aria-live="polite">
          {result.ok ? `${formatCount(result.paths.length, 'item')} of ${entries.length.toLocaleString()} match · ${formatCount(next.length, 'item')} will be selected` : ''}
        </span>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!result.ok} onClick={apply}>Select</Button>
      </>
    }>
      <form className="form" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <Segmented<PatternMode> label="Match by" value={mode} onChange={(m) => setMode(m)} options={[{ value: 'glob', label: 'Wildcards' }, { value: 'regex', label: 'Regular expression' }, { value: 'type', label: 'Type' }]} />
        {mode === 'glob' && <TextField label="Pattern" mono value={pattern} data-autofocus onChange={(e) => setPattern(e.target.value)} hint="* any characters, ? one character, [abc] one of them. Several patterns: separate with ;" error={touched && !result.ok ? result.reason : undefined} />}
        {mode === 'regex' && <TextField label="Regular expression (matched anywhere in the name)" mono value={pattern} data-autofocus onChange={(e) => setPattern(e.target.value)} hint="Example: ^IMG_\d{4}\.jpe?g$" error={touched && !result.ok ? result.reason : undefined} />}
        {mode === 'type' && (
          <>
            <TextField label="Extensions" mono value={pattern} data-autofocus onChange={(e) => setPattern(e.target.value)} hint="For example: jpg png .webp (separate with spaces or commas)" error={touched && !result.ok ? result.reason : undefined} />
            <fieldset className="check-grid">
              <legend className="field-label">Types</legend>
              {TYPE_CHOICES.map((t) => (
                <label key={t.value} className="check">
                  <input type="checkbox" checked={categories.includes(t.value)} onChange={(e) => setCategories(e.target.checked ? [...categories, t.value] : categories.filter((c) => c !== t.value))} /> {t.label}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {mode !== 'type' && (
          <div className="check-row">
            <label className="check"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case</label>
            <label className="check"><input type="checkbox" checked={includeFolders} onChange={(e) => setIncludeFolders(e.target.checked)} /> Include folders</label>
          </div>
        )}
        <Segmented<SelectOp> label="Selection" value={op} onChange={setOp} options={[{ value: 'replace', label: 'Replace selection' }, { value: 'add', label: 'Add to selection' }, { value: 'remove', label: 'Remove from selection' }]} />
        {filter && <p className="muted small">Only items shown by the folder’s filter “{found?.pane.filter}” are considered.</p>}
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- verify checksum file */

interface VerifyReport { file: string; folder: string; algorithm?: string; items: VerifyItem[]; problems: Array<{ line: number; text: string; reason: string }>; summary: VerifySummary; complete: boolean }

const STATUS_LABEL: Record<VerifyStatus, string> = { ok: 'OK', mismatch: 'Mismatch', missing: 'Missing', unreadable: 'Unreadable', refused: 'Refused' };
const STATUS_TONE: Record<VerifyStatus, 'success' | 'error' | 'warning'> = { ok: 'success', mismatch: 'error', missing: 'warning', unreadable: 'warning', refused: 'error' };
const ROW_LIMIT = 2000;

/** Runs the verification as a pausable background job and shows OK / mismatch / missing / unreadable per file. */
export function ChecksumVerifyDialog({ path }: { path: string }) {
  const name = path.split(/[\\/]/).pop() ?? path;
  const [job, setJob] = useState<JobHandle<VerifyReport> | null>(null);
  const [progress, setProgress] = useState<{ checked: number; total: number; current?: string } | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const paused = useJobPaused(job?.jobId);
  useEffect(() => {
    const h = runJob<VerifyReport>((jobId) => call('tool:verifyChecksums', { path, jobId }), (p) => setProgress(p as typeof progress), `Verify ${name}`);
    setJob(h);
    h.promise.then((r) => {
      setCancelled(r.cancelled);
      if (r.value) setReport(r.value);
      setJob(null);
    }, (err) => {
      setError((err as Error).message);
      setJob(null);
    });
    return () => h.cancel();
  }, [path, name]);
  const s = report?.summary;
  const bad = s ? s.mismatch + s.missing + s.unreadable + s.refused : 0;
  const rows = (report?.items ?? []).filter((i) => !onlyProblems || i.status !== 'ok');
  return (
    <Dialog title={`Verify ${name}`} width={860} onClose={() => { job?.cancel(); closeDialog(); }} footer={
      job ? (
        <>
          <JobPauseButton jobId={job.jobId} />
          <Button onClick={() => job.cancel()}>Stop</Button>
        </>
      ) : <Button variant="primary" onClick={closeDialog}>Done</Button>
    }>
      {job && (
        <div className="verify-progress" role="status" aria-live="polite">
          <ProgressBar label="Verification progress" value={progress?.total ? progress.checked / progress.total : undefined} />
          <p className="muted small">{paused ? 'Paused · ' : ''}{progress ? `${progress.checked.toLocaleString()} of ${progress.total.toLocaleString()} files checked${progress.current ? ` · ${progress.current}` : ''}` : 'Reading the checksum file…'}</p>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {cancelled && !report && <p className="muted">Stopped before any result was available.</p>}
      {report && s && (
        <>
          <p className={bad ? 'error-text' : 'success-text'} role="status">
            {!report.complete ? `Stopped early: ${s.total.toLocaleString()} file${s.total === 1 ? '' : 's'} checked. ` : ''}
            {bad === 0 ? (s.ok === 1 ? 'The file matches its checksum.' : `All ${s.ok.toLocaleString()} files match their checksums.`) : `${formatCount(bad, 'problem')} found; ${s.ok.toLocaleString()} file${s.ok === 1 ? '' : 's'} match.`}
          </p>
          <div className="pill-row">
            <Pill tone="success">OK {s.ok}</Pill>
            <Pill tone={s.mismatch ? 'error' : 'neutral'}>Mismatch {s.mismatch}</Pill>
            <Pill tone={s.missing ? 'warning' : 'neutral'}>Missing {s.missing}</Pill>
            <Pill tone={s.unreadable ? 'warning' : 'neutral'}>Unreadable {s.unreadable}</Pill>
            {s.refused > 0 && <Pill tone="error">Refused {s.refused}</Pill>}
            {s.problems > 0 && <Pill tone="warning">Lines not understood {s.problems}</Pill>}
            <span className="muted small">{report.algorithm ? report.algorithm.toUpperCase() : 'Algorithm from each line'} · paths relative to <span className="mono">{report.folder}</span></span>
          </div>
          <label className="check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only files with problems</label>
          {rows.length ? (
            <div className="verify-table">
              <table className="table compact">
                <thead><tr><th>Status</th><th>File</th><th>Details</th></tr></thead>
                <tbody>
                  {rows.slice(0, ROW_LIMIT).map((i) => (
                    <tr key={`${i.line}:${i.path}`}>
                      <td><Pill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Pill></td>
                      <td className="mono" title={`Line ${i.line}`}>{i.path}</td>
                      <td className="small">
                        {i.reason && <div>{i.reason}</div>}
                        {i.status === 'mismatch' && <div className="mono muted">expected {i.expected}<br />actual&nbsp;&nbsp; {i.actual}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > ROW_LIMIT && <p className="muted small">The first {ROW_LIMIT.toLocaleString()} of {rows.length.toLocaleString()} rows are shown.</p>}
            </div>
          ) : <p className="muted">{onlyProblems ? 'No problems.' : 'No files were checked.'}</p>}
          {report.problems.length > 0 && (
            <details>
              <summary>{formatCount(report.problems.length, 'line')} could not be read as checksums</summary>
              <ul className="small">{report.problems.slice(0, 200).map((p) => <li key={p.line}><span className="muted">Line {p.line}:</span> {p.reason} <span className="mono muted">{p.text}</span></li>)}</ul>
            </details>
          )}
        </>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- templates */

/** Choose a template from the templates folder; creating it asks for the name. */
export function TemplatesDialog({ paneId }: { paneId: string }) {
  const st = useStore(templates, (s) => s);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void refreshTemplates().finally(() => setLoading(false));
  }, []);
  const listing = st.listing;
  const pick = (t: NonNullable<typeof listing>['templates'][number]) => {
    closeDialog();
    void newFromTemplate(paneId, t);
  };
  return (
    <Dialog title="New file from template" onClose={closeDialog} footer={
      <>
        {listing?.folder && <Button variant="ghost" onClick={() => { closeDialog(); void navigate(paneId, { kind: 'fs', path: listing.folder! }); }}>Open templates folder</Button>}
        <Button variant="ghost" onClick={() => { closeDialog(); void navigate(paneId, { kind: 'tool', tool: 'settings' }); }}>Choose folder…</Button>
        <Button onClick={closeDialog}>Cancel</Button>
      </>
    }>
      {listing?.folder && <p className="muted small">Templates are the files in <span className="mono">{listing.folder}</span>{listing.source === 'xdg' ? ' (the desktop’s templates folder)' : ''}. A new file is an exact copy; nothing existing is replaced.</p>}
      {listing?.note && <p className="muted small">{listing.note}</p>}
      {st.error && <p className="error-text">{st.error}</p>}
      {loading && !listing ? <p className="muted">Reading templates…</p> : listing?.templates.length ? (
        <div className="choice-list" role="list">
          {listing.templates.map((t, i) => (
            <button key={t.path} type="button" role="listitem" className="choice" data-autofocus={i === 0 || undefined} onClick={() => pick(t)}>
              <strong>{t.name}</strong><span>{formatBytes(t.size)}</span>
            </button>
          ))}
        </div>
      ) : listing?.folder ? <p className="muted">The templates folder has no files. Put files there to offer them under New.</p> : null}
    </Dialog>
  );
}

