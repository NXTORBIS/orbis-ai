import React, { useMemo, useState } from 'react';
import { call, runJob } from '../../api';
import { app } from '../../state/app';
import { useStore } from '../../state/store';
import { Dialog, EmptyState, ErrorState, Loading, Pill, ProgressBar, Segmented } from '../../ui/components';
import { formatBytes, formatDate } from '../../ui/format';
import { startOperation } from '../../actions';
import { FilePicker, FolderPicker, JobPauseButton, useJobPaused } from './common';
import { SimilarImagesView } from './MediaTools';
import { ExactDuplicates } from './Duplicates';

/* ---------------------------------------------------------------- duplicates */

export function DuplicatesView() {
  const [mode, setMode] = useState<'exact' | 'similar'>('exact');
  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Find duplicates</h1>
        <Segmented<'exact' | 'similar'> label="What to look for" value={mode} onChange={setMode} options={[{ value: 'exact', label: 'Exact duplicates' }, { value: 'similar', label: 'Similar images' }]} />
      </header>
      {mode === 'exact' ? <ExactDuplicates /> : <SimilarImagesView />}
    </div>
  );
}

/* ---------------------------------------------------------------- compare */

interface CmpEntry { rel: string; kind: string; leftSize?: number; rightSize?: number; leftMtime?: number; rightMtime?: number; reason?: string }
interface CmpReport { left: string; right: string; verifyContent: boolean; onlyLeft: CmpEntry[]; onlyRight: CmpEntry[]; identical: CmpEntry[]; different: CmpEntry[]; probablySame: CmpEntry[]; renamed: Array<{ left: string; right: string; size: number }>; errors: string[]; complete: boolean; cancelled: boolean }

/** Folder comparison as a tool view, or `embedded` in a dialog (the dialog supplies the title and the scrolling). */
export function CompareView({ initialLeft, initialRight, embedded }: { initialLeft?: string; initialRight?: string; embedded?: boolean }) {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const [left, setLeft] = useState(initialLeft ?? home);
  const [right, setRight] = useState(initialRight ?? home);
  const [verify, setVerify] = useState(true);
  const [report, setReport] = useState<CmpReport | null>(null);
  const [running, setRunning] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(running?.jobId);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'different' | 'onlyLeft' | 'onlyRight' | 'identical' | 'renamed'>('different');

  const run = () => {
    setReport(null);
    setError(null);
    const j = runJob<CmpReport>((jobId) => call('tool:compareDirs', { left, right, jobId, verifyContent: verify }), undefined, 'Comparing folders');
    setRunning({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then((r) => { setRunning(null); if (r.value) setReport(r.value); }, (e) => { setRunning(null); setError((e as Error).message); });
  };

  const copyAcross = async (rels: string[], dir: 'toRight' | 'toLeft') => {
    if (!report) return;
    const from = dir === 'toRight' ? report.left : report.right;
    const to = dir === 'toRight' ? report.right : report.left;
    const sep = from.includes('\\') ? '\\' : '/';
    // Copy each item into the matching relative folder on the other side.
    const byDest = new Map<string, string[]>();
    for (const rel of rels) {
      const parts = rel.split('/');
      const destDir = [to, ...parts.slice(0, -1)].join(sep);
      byDest.set(destDir, [...(byDest.get(destDir) ?? []), [from, ...parts].join(sep)]);
    }
    for (const [dest, sources] of byDest) await startOperation({ type: 'copy', sources, destination: dest, conflictPolicy: 'ask', origin: 'compare' });
  };

  const lists = report ? { different: report.different, onlyLeft: report.onlyLeft, onlyRight: report.onlyRight, identical: [...report.identical, ...report.probablySame], renamed: report.renamed.map((r): CmpEntry => ({ rel: `${r.left} → ${r.right}`, kind: 'file', leftSize: r.size, rightSize: r.size })) } : null;

  return (
    <div className={embedded ? 'compare-embedded' : 'tool-view scroll-y'}>
      {embedded ? <p className="muted">Compares the two folders by name, size and modification time; with content verification on, files are compared by SHA-256 and renamed copies are detected.</p> : (
        <header className="view-header">
          <h1>Compare folders</h1>
          <p className="muted">Compares two folders by name, size and modification time; with content verification on, files are compared by SHA-256 and renamed copies are detected.</p>
        </header>
      )}
      <div className="tool-controls two">
        <FolderPicker value={left} onChange={setLeft} label="Left folder" />
        <FolderPicker value={right} onChange={setRight} label="Right folder" />
      </div>
      <div className="tool-controls">
        <label className="check"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> Verify file contents (slower, exact)</label>
        <span className="spacer" />
        {running ? <><JobPauseButton jobId={running.jobId} /><button type="button" className="btn btn-default btn-md" onClick={running.cancel}>Stop</button></> : <button type="button" className="btn btn-primary btn-md" disabled={left === right} onClick={run}>Compare</button>}
      </div>
      {running && <div className="tool-progress" role="status"><ProgressBar label="Comparing" tone={paused ? 'warning' : 'accent'} /><span>{paused ? 'Paused' : 'Comparing…'}</span></div>}
      {error && <ErrorState title="Comparison failed" body={error} />}
      {!report && !running && !error && !embedded && <EmptyState icon="compare" title="Choose two folders and select Compare" body={left === right ? 'The left and right folders are the same folder; choose a different one on either side.' : 'Nothing is changed by comparing. Afterwards you can copy missing items across or look at the differences in a file.'} />}
      {report && lists && (
        <>
          <Segmented<typeof show>
            label="Result category"
            value={show}
            onChange={setShow}
            options={[
              { value: 'different', label: `Different (${report.different.length})` },
              { value: 'onlyLeft', label: `Only left (${report.onlyLeft.length})` },
              { value: 'onlyRight', label: `Only right (${report.onlyRight.length})` },
              { value: 'identical', label: `${verify ? 'Identical' : 'Probably same'} (${lists.identical.length})` },
              ...(verify ? [{ value: 'renamed' as const, label: `Renamed (${report.renamed.length})` }] : []),
            ]}
          />
          {!report.complete && <p className="warning-text">{report.cancelled ? 'Stopped early — results are partial.' : `${report.errors.length} location(s) could not be read; results are partial.`}</p>}
          {!verify && <p className="muted small">Without verification, “probably same” means same size and time; contents were not checked.</p>}
          {(show === 'onlyLeft' || show === 'onlyRight') && lists[show].length > 0 && (
            <div className="selection-bar">
              <button type="button" className="btn btn-default btn-sm" onClick={() => void copyAcross(lists[show].filter((e) => !lists[show].some((o) => o !== e && e.rel.startsWith(`${o.rel}/`))).map((e) => e.rel), show === 'onlyLeft' ? 'toRight' : 'toLeft')}>
                Copy all to the {show === 'onlyLeft' ? 'right' : 'left'}…
              </button>
            </div>
          )}
          {!lists[show].length ? <EmptyState icon="check" title="Nothing in this category" /> : (
            <table className="table compare-table">
              <thead><tr><th>Item</th><th>Left</th><th>Right</th>{show === 'different' && <th className="wide-only">Why</th>}<th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {lists[show].map((e) => (
                  <tr key={e.rel}>
                    <td className="cell-path"><span className="mono">{e.rel}{e.kind === 'directory' ? '/' : ''}</span>{show === 'different' && e.reason && <div className="cell-sub narrow-only">{e.reason}</div>}</td>
                    <td className="tabular"><span className="nowrap">{e.leftSize !== undefined ? formatBytes(e.leftSize) : e.leftMtime ? '' : '—'}</span>{e.leftMtime ? <div className="muted small cmp-date">{formatDate(e.leftMtime)}</div> : null}</td>
                    <td className="tabular"><span className="nowrap">{e.rightSize !== undefined ? formatBytes(e.rightSize) : e.rightMtime ? '' : '—'}</span>{e.rightMtime ? <div className="muted small cmp-date">{formatDate(e.rightMtime)}</div> : null}</td>
                    {show === 'different' && <td className="muted wide-only">{e.reason}</td>}
                    <td className="row-actions">
                      {show === 'different' && e.kind === 'file' && e.leftSize !== undefined && e.rightSize !== undefined && <FileDiffButton name={e.rel} left={`${report.left}/${e.rel}`} right={`${report.right}/${e.rel}`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function FileDiffButton({ name, left, right }: { name: string; left: string; right: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Show differences in ${name}`} onClick={() => setOpen(true)}>Show differences</button>
      {open && (
        <Dialog title={`Differences · ${name}`} width={1100} onClose={() => setOpen(false)}>
          <FileCompare left={left} right={right} />
        </Dialog>
      )}
    </>
  );
}

export interface TextDiff { hunks: Array<{ kind: 'same' | 'added' | 'removed'; lines: string[] }>; added: number; removed: number; identical: boolean; leftHash: string; rightHash: string }
interface StructDiff { format: string; formattingOnly: boolean; changes: Array<{ path: string; kind: string; left?: string; right?: string }>; truncated: boolean }

/** Compare two files: line diff for text, semantic diff for JSON/CSV, checksums for binaries. */
export function FileCompare({ left: l0, right: r0 }: { left: string; right: string }) {
  const [left, setLeft] = useState(l0);
  const [right, setRight] = useState(r0);
  const [mode, setMode] = useState<'text' | 'structured'>(/\.(json|csv)$/i.test(l0) ? 'structured' : 'text');
  const [text, setText] = useState<TextDiff | null>(null);
  const [struct, setStruct] = useState<StructDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<{ l?: string; r?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<'unified' | 'split'>('split');

  React.useEffect(() => {
    setText(null);
    setStruct(null);
    setError(null);
    setHashes(null);
    setLoading(true);
    const p = mode === 'text' ? call<TextDiff>('tool:diffText', { left, right }).then(setText) : call<StructDiff>('tool:diffStructured', { left, right }).then(setStruct);
    p.catch(async (e) => {
      setError((e as Error).message);
      // Fall back to checksums so binary/large files still get an exact answer.
      const h = async (path: string) => {
        const r = runJob<{ digest: string }>((jobId) => call('fs:hash', { path, algorithm: 'sha256', jobId }));
        return (await r.promise).value?.digest;
      };
      const [a, b] = await Promise.all([h(left).catch(() => undefined), h(right).catch(() => undefined)]);
      setHashes({ l: a, r: b });
    }).finally(() => setLoading(false));
  }, [left, right, mode]);

  return (
    <div className="file-compare">
      <div className="tool-controls two">
        <FilePicker id="cmp-left" value={left} onChange={setLeft} label="Left file" />
        <FilePicker id="cmp-right" value={right} onChange={setRight} label="Right file" />
      </div>
      <div className="tool-controls">
        <Segmented<'text' | 'structured'> label="Comparison type" value={mode} onChange={setMode} options={[{ value: 'text', label: 'Text lines' }, { value: 'structured', label: 'JSON / CSV data' }]} />
        {mode === 'text' && <Segmented<'unified' | 'split'> label="Layout" value={layout} onChange={setLayout} options={[{ value: 'split', label: 'Side by side' }, { value: 'unified', label: 'Unified' }]} />}
      </div>
      {loading && <Loading label="Comparing…" />}
      {error && (
        <div className="callout">
          <p>{error}</p>
          {hashes && (
            <p className="mono small">
              SHA-256 left: {hashes.l ?? 'unavailable'}<br />SHA-256 right: {hashes.r ?? 'unavailable'}<br />
              <strong>{hashes.l && hashes.r ? (hashes.l === hashes.r ? 'The files are byte-for-byte identical.' : 'The files differ.') : 'Could not compute both checksums.'}</strong>
            </p>
          )}
        </div>
      )}
      {text && (
        <>
          <p className="muted">{text.identical ? 'The files are identical.' : `${text.added} line${text.added === 1 ? '' : 's'} added, ${text.removed} removed.`}</p>
          {!text.identical && <TextDiffBody text={text} layout={layout} />}
        </>
      )}
      {struct && (
        <>
          <p className="muted">{struct.changes.length ? `${struct.changes.length}${struct.truncated ? '+' : ''} data difference${struct.changes.length === 1 ? '' : 's'}.` : struct.formattingOnly ? 'Only formatting differs; the data is the same.' : 'The data is identical.'}</p>
          {struct.changes.length > 0 && (
            <table className="table">
              <thead><tr><th>Where</th><th>Change</th><th>Left</th><th>Right</th></tr></thead>
              <tbody>{struct.changes.map((c, i) => <tr key={i}><td className="mono">{c.path}</td><td><Pill tone={c.kind === 'added' ? 'success' : c.kind === 'removed' ? 'error' : 'warning'}>{c.kind}</Pill></td><td className="mono">{c.left ?? ''}</td><td className="mono">{c.right ?? ''}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/** Line diff rendering shared by Compare and the AI edit review. */
export function TextDiffBody({ text, layout }: { text: TextDiff; layout: 'unified' | 'split' }) {
  const split = useMemo(() => {
    const rows: Array<{ l?: string; r?: string; kind: string }> = [];
    for (let i = 0; i < text.hunks.length; i++) {
      const h = text.hunks[i]!;
      if (h.kind === 'same') h.lines.forEach((x) => rows.push({ l: x, r: x, kind: 'same' }));
      else if (h.kind === 'removed' && text.hunks[i + 1]?.kind === 'added') {
        const add = text.hunks[i + 1]!;
        const n = Math.max(h.lines.length, add.lines.length);
        for (let k = 0; k < n; k++) rows.push({ l: h.lines[k], r: add.lines[k], kind: 'changed' });
        i++;
      } else if (h.kind === 'removed') h.lines.forEach((x) => rows.push({ l: x, kind: 'removed' }));
      else h.lines.forEach((x) => rows.push({ r: x, kind: 'added' }));
    }
    return rows;
  }, [text]);
  if (layout === 'unified') {
    return <pre className="diff unified">{text.hunks.flatMap((h, i) => h.lines.map((line, k) => <div key={`${i}-${k}`} className={`dl ${h.kind}`}><span className="dm">{h.kind === 'added' ? '+' : h.kind === 'removed' ? '−' : ' '}</span>{line}</div>))}</pre>;
  }
  return (
    <div className="diff split">
      {split.map((r, i) => (
        <React.Fragment key={i}>
          <div className={`dl ${r.kind === 'added' ? 'empty' : r.kind === 'same' ? 'same' : 'removed'}`}>{r.l ?? ''}</div>
          <div className={`dl ${r.kind === 'removed' ? 'empty' : r.kind === 'same' ? 'same' : 'added'}`}>{r.r ?? ''}</div>
        </React.Fragment>
      ))}
    </div>
  );
}
