import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, runJob, type JobHandle } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import { Button, Dialog, Pill, Segmented, Select, TextField } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes, formatDate } from '../ui/format';
import { watchOperation, startTransfer } from '../actions';
import { refreshClipboard } from '../state/clipboard';
import { FolderPicker } from './views/common';
import type { OperationRecord } from '../../shared/operations';
import {
  defaultPasteName, DESCRIPTOR_SUFFIX, GiB, KiB, MAX_SPLIT_PARTS, MiB, partName, PASTE_TEXT_FORMATS, planSplit, SPLIT_PRESETS,
  type ClipHistoryEntry, type ClipPeek, type DatesPlan, type DatesSpec, type FlattenPlan, type FlattenSpec, type JoinPlan, type PasteTextFormat, type ShredInfo, type SplitParams,
} from '../../shared/powerTools';

/**
 * Dialogs of the power tools and the clipboard (opened as 'pt.*' dialogs from
 * powerCommands.ts). Each shows what will happen before anything changes; the
 * work is an operation in the main process (queue, progress, pause, cancel,
 * undo where it makes sense), reported by the usual result toast.
 */

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || '/';
const relTo = (root: string, p: string) => {
  const r = root.replace(/[\\/]+$/, '');
  return p.startsWith(r) ? p.slice(r.length).replace(/^[\\/]+/, '') : p;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const bytesExact = (n: number) => `${n.toLocaleString()} bytes`;

/** Start an operation through a pt:/clip: channel and follow it like any other. */
async function startVia(start: () => Promise<OperationRecord>): Promise<boolean> {
  try {
    const rec = await start();
    watchOperation(rec.id);
    return true;
  } catch (err) {
    toastError(err);
    return false;
  }
}

/** Run a planning job again whenever `deps` change (debounced); an older run is cancelled. */
function usePlan<T>(start: ((jobId: string) => Promise<unknown>) | null, deps: unknown[]): { plan: T | null; error: string | null; progress: string | null; busy: boolean } {
  const [plan, setPlan] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const ref = useRef<JobHandle<T> | null>(null);
  useEffect(() => {
    if (!start) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      ref.current?.cancel();
      const job = runJob<T>(start, (p) => {
        const o = p as { stage?: string; items?: number };
        if (o?.items) setProgress(`${o.stage ?? 'Working'}… ${o.items.toLocaleString()}`);
      });
      ref.current = job;
      job.promise.then((r) => {
        if (ref.current !== job || r.cancelled) return;
        setPlan(r.value ?? null);
        setError(null);
        setProgress(null);
        setBusy(false);
      }, (e) => {
        if (ref.current !== job) return;
        setError((e as Error).message);
        setPlan(null);
        setProgress(null);
        setBusy(false);
      });
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => ref.current?.cancel(), []);
  return { plan, error, progress, busy };
}

function Summary({ children }: { children: ReactNode }) {
  return <span className="muted small grow pt-summary" aria-live="polite">{children}</span>;
}

function Warn({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'info' }) {
  return <div className={`callout ${tone === 'warning' ? 'warning' : ''}`}><Icon name={tone === 'warning' ? 'warning' : 'info'} size={16} /><div className="pt-callout-text">{children}</div></div>;
}

// ------------------------------------------------------------------ split

type Unit = 'KB' | 'MB' | 'GB';
const UNIT: Record<Unit, number> = { KB: KiB, MB: MiB, GB: GiB };

export function SplitDialog({ path, name, size, dir }: { path: string; name: string; size: number; dir?: string }) {
  const [mode, setMode] = useState<SplitParams['mode']>('size');
  const [preset, setPreset] = useState<string>(size > 700 * MiB ? '700m' : '100m');
  const [custom, setCustom] = useState('50');
  const [unit, setUnit] = useState<Unit>('MB');
  const [parts, setParts] = useState('2');
  const [descriptor, setDescriptor] = useState(true);
  const [dest, setDest] = useState(dir ?? dirOf(path));
  const [starting, setStarting] = useState(false);
  const partBytes = preset === 'custom' ? Math.floor(Number(custom.replace(',', '.')) * UNIT[unit]) : SPLIT_PRESETS.find((p) => p.id === preset)!.bytes;
  const params: SplitParams = mode === 'size' ? { mode, partBytes: Number.isFinite(partBytes) ? partBytes : 0, descriptor } : { mode, parts: Math.floor(Number(parts)) || 0, descriptor };
  const plan = planSplit(size, params);
  const ok = !('error' in plan);
  const go = async () => {
    if (!ok) return;
    setStarting(true);
    if (await startVia(() => call('pt:splitStart', { path, destination: dest, params }))) closeDialog();
    setStarting(false);
  };
  return (
    <Dialog title={`Split ${name}`} onClose={closeDialog} width={560} className="pt-dialog" footer={
      <>
        <Summary>{ok ? `${plural(plan.parts, 'part')} of ${formatBytes(plan.partBytes)}${plan.lastBytes !== plan.partBytes ? ` (the last ${formatBytes(plan.lastBytes)})` : ''}` : plan.error}</Summary>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="splitFile" disabled={!ok || starting} onClick={() => void go()}>{ok ? `Split into ${plan.parts.toLocaleString()} parts` : 'Split'}</Button>
      </>
    }>
      <p className="muted small">{name} · {formatBytes(size)} ({bytesExact(size)})</p>
      <Segmented<SplitParams['mode']> label="Split by" value={mode} onChange={setMode} options={[{ value: 'size', label: 'Part size' }, { value: 'count', label: 'Number of parts' }]} />
      {mode === 'size' ? (
        <div className="pt-row">
          <Select<string> id="pt-split-preset" label="Part size" value={preset} onChange={setPreset} options={[...SPLIT_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom size…' }]} />
          {preset === 'custom' && (
            <>
              <TextField id="pt-split-custom" label="Size" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} className="pt-num" />
              <Select<Unit> id="pt-split-unit" label="Unit" value={unit} onChange={setUnit} options={[{ value: 'KB', label: 'KB (1,024 bytes)' }, { value: 'MB', label: 'MB (1,024 KB)' }, { value: 'GB', label: 'GB (1,024 MB)' }]} />
            </>
          )}
        </div>
      ) : (
        <TextField id="pt-split-parts" label={`Number of parts (2 – ${MAX_SPLIT_PARTS.toLocaleString()})`} inputMode="numeric" value={parts} onChange={(e) => setParts(e.target.value)} className="pt-num" />
      )}
      {mode === 'size' && Number.isFinite(partBytes) && partBytes > 0 && <p className="field-hint">Each part: {bytesExact(partBytes)}.</p>}
      <FolderPicker id="pt-split-dest" label="Save the parts in" value={dest} onChange={setDest} />
      <label className="check"><input type="checkbox" checked={descriptor} onChange={(e) => setDescriptor(e.target.checked)} /> Write checksums for verifying the join ({name}{DESCRIPTOR_SUFFIX})</label>
      {ok && <p className="muted small mono pt-names">{partName(name, 1, plan.parts)} … {partName(name, plan.parts, plan.parts)}</p>}
      <p className="muted small">The file is read once and streamed; it is not changed. Existing files are never replaced. Join the parts again with “Join files…” here or with 7-Zip, HJSplit or <span className="mono">cat</span>.</p>
    </Dialog>
  );
}

// ------------------------------------------------------------------ join

export function JoinDialog({ path }: { path: string }) {
  const [plan, setPlan] = useState<JoinPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    void call<JoinPlan>('pt:joinPlan', { path }).then(setPlan, (e) => setError((e as Error).message));
  }, [path]);
  const go = async () => {
    setStarting(true);
    if (await startVia(() => call('pt:joinStart', { path, options: { keepOnMismatch: keep } }))) closeDialog();
    setStarting(false);
  };
  const missing = plan?.missing ?? [];
  const canJoin = !!plan && !missing.length && plan.parts.length > 0;
  return (
    <Dialog title={`Join ${plan ? plan.base : base(path)}`} onClose={closeDialog} width={600} className="pt-dialog" footer={
      <>
        <Summary>{error ?? (!plan ? 'Looking for the parts…' : missing.length ? `${plural(missing.length, 'part')} missing` : `${plural(plan.parts.length, 'part')} · ${formatBytes(plan.totalBytes)} → ${plan.output}`)}</Summary>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="joinFiles" disabled={!canJoin || starting} onClick={() => void go()}>{canJoin ? `Join ${plan.parts.length} parts` : 'Join'}</Button>
      </>
    }>
      {error && <p className="error-text">{error}</p>}
      {!plan && !error && <p className="muted small" role="status">Looking for the parts…</p>}
      {plan && (
        <>
          {missing.length > 0 && <Warn><strong>Missing: </strong>{missing.slice(0, 12).join(', ')}{missing.length > 12 ? ` and ${missing.length - 12} more` : ''}. Nothing can be joined until every part is in this folder.</Warn>}
          {plan.descriptor ? (
            <p className="pt-status"><Pill tone="success">Will be verified</Pill> SHA-256 of every part and of the whole file from {plan.descriptor.name}.</p>
          ) : (
            <p className="pt-status"><Pill tone="warning">Not verified</Pill> {plan.descriptorProblem ?? 'There is no checksum descriptor (parts made by 7-Zip, HJSplit or split); the parts are only joined in order.'}</p>
          )}
          {plan.descriptor && plan.descriptorProblem && <Warn>{plan.descriptorProblem}</Warn>}
          {plan.sizeProblems.length > 0 && <Warn>{plan.sizeProblems.slice(0, 4).join(' ')}</Warn>}
          <div className="pt-table-wrap">
            <table className="pt-table" aria-label="Parts in order">
              <thead><tr><th scope="col">Part</th><th scope="col" className="num">Size</th></tr></thead>
              <tbody>{plan.parts.slice(0, 400).map((p) => (
                <tr key={p.path} className={p.expectedSize !== undefined && p.expectedSize !== p.size ? 'is-conflict' : ''}><td><span className="ellipsis mono" title={p.path}>{p.name}</span></td><td className="num tabular">{formatBytes(p.size)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="small">Joined file: <span className="mono">{plan.output}</span>{plan.outputTaken ? <span className="muted"> (the name {plan.descriptor?.originalName ?? plan.base} is taken)</span> : null} in {plan.folder}</p>
          {plan.descriptor && <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep the joined file even if the check fails</label>}
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ shred

export function ShredDialog({ paths, names }: { paths: string[]; names: string[] }) {
  const [passes, setPasses] = useState<'1' | '3'>('1');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const { plan: info, error, progress } = usePlan<ShredInfo>((jobId) => call('pt:shredInfo', { paths, jobId }), [paths]);
  const go = async () => {
    setStarting(true);
    if (await startVia(() => call('pt:shredStart', { paths, params: { passes: Number(passes) as 1 | 3, confirmed: true } }))) closeDialog();
    setStarting(false);
  };
  const what = paths.length === 1 ? `“${names[0]}”` : plural(paths.length, 'item');
  const list = <ul className="confirm-detail mono pt-names-list">{names.map((n) => <li key={n}>{n}</li>)}{paths.length > names.length && <li>…and {paths.length - names.length} more</li>}</ul>;
  if (confirming) {
    return (
      <Dialog key="confirm" title={`Shred ${what}? This cannot be undone.`} onClose={() => setConfirming(false)} width={520} className="pt-dialog pt-shred-confirm" footer={
        <>
          <Button onClick={() => setConfirming(false)} data-autofocus>Go back</Button>
          <Button variant="danger" icon="shred" disabled={starting} onClick={() => void go()}>Shred permanently</Button>
        </>
      }>
        <p><strong>{info ? `${plural(info.files, 'file')}${info.folders ? ` in ${plural(info.folders, 'folder')}` : ''} (${formatBytes(info.bytes)})` : what}</strong> will be overwritten {passes === '1' ? 'once' : '3 times'} with random data and removed. They do not go to the Trash and cannot be undone or restored by Orbis Files.</p>
        {list}
        {info?.filesystems.some((f) => f.copyOnWrite || f.solidState) && <p className="warning-text small">On this drive old copies may remain despite the overwrite (see the previous step).</p>}
      </Dialog>
    );
  }
  return (
    <Dialog key="main" title={`Shred (secure delete) ${what}`} onClose={closeDialog} width={620} className="pt-dialog pt-shred" footer={
      <>
        <Summary>{error ?? (info ? `${plural(info.files, 'file')} · ${formatBytes(info.bytes)}` : progress ?? 'Counting…')}</Summary>
        <Button onClick={closeDialog} data-autofocus>Cancel</Button>
        <Button variant="danger" icon="shred" disabled={!info} onClick={() => setConfirming(true)}>Shred…</Button>
      </>
    }>
      <p>The contents are overwritten with random data, flushed to the drive, then the file is renamed to a random name, truncated and removed. <strong>This cannot be undone.</strong></p>
      {list}
      {error && <p className="error-text">{error}</p>}
      {info && (
        <p className="small">
          {plural(info.files, 'file')}, {plural(info.folders, 'folder')}{info.links ? `, ${plural(info.links, 'link')} (removed, never followed)` : ''}{info.others ? `, ${plural(info.others, 'special file')} (removed without writing)` : ''} · {formatBytes(info.bytes)} to overwrite{info.truncated ? ' (counting stopped at 200,000 items)' : ''}.
        </p>
      )}
      {info && info.hardLinked > 0 && <Warn>{plural(info.hardLinked, 'file has', 'files have')} other hard links. Overwriting would change the contents seen through the other names too, so {info.hardLinked === 1 ? 'it is' : 'they are'} left alone and reported.</Warn>}
      <Warn>
        <strong>Old data may remain.</strong> Overwriting in place reliably reaches the old contents only on traditional hard disks with simple file systems. On SSDs and flash memory, on copy-on-write file systems (btrfs, ZFS, APFS), with snapshots, journaling, backups, or files synchronized to the cloud, earlier copies can survive. For those, use full-disk encryption or the drive’s secure erase.
      </Warn>
      {info?.filesystems.map((f) => (
        <div key={f.where} className="pt-fs">
          <p className="small"><Icon name="drive" size={14} /> <span className="mono">{f.where}</span>: {f.type}{f.solidState === true ? ' · SSD/flash' : f.solidState === false ? ' · spinning disk' : ''}</p>
          {f.warnings.length > 0 && <ul className="pt-fs-warn small">{f.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      ))}
      <Segmented<'1' | '3'> label="Overwrite passes" value={passes} onChange={setPasses} options={[{ value: '1', label: '1 pass (random)' }, { value: '3', label: '3 passes (random)' }]} />
      <p className="muted small">Stopping finishes the file being overwritten, then stops; the result lists exactly what was destroyed.</p>
    </Dialog>
  );
}

// ------------------------------------------------------------------ flatten

export function FlattenDialog({ path }: { path: string }) {
  const [spec, setSpec] = useState<FlattenSpec>({ removeEmpty: true, includeHidden: false });
  const [starting, setStarting] = useState(false);
  const { plan, error, progress, busy } = usePlan<FlattenPlan>((jobId) => call('pt:flattenPlan', { path, spec, jobId }), [path, spec]);
  const total = plan?.movesTotal ?? plan?.moves.length ?? 0;
  const go = async () => {
    setStarting(true);
    if (await startVia(() => call('pt:flattenStart', { path, spec }))) closeDialog();
    setStarting(false);
  };
  const leftAlone = plan ? [plan.links ? plural(plan.links, 'link') : '', plan.hidden ? plural(plan.hidden, 'hidden item') : '', plan.others ? plural(plan.others, 'special file') : ''].filter(Boolean) : [];
  return (
    <Dialog title={`Flatten ${base(path)}`} onClose={closeDialog} width={720} className="pt-dialog" footer={
      <>
        <Summary>{error ?? (busy || !plan ? progress ?? 'Looking inside…' : !total ? 'Nothing to move' : `${plural(total, 'file')} from ${plural(plan.folders, 'subfolder')}${plan.conflicts ? ` · ${plural(plan.conflicts, 'name conflict')}` : ''}`)}</Summary>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="flatten" disabled={!plan || !total || busy || starting || plan.truncated} onClick={() => void go()}>{plan && total ? `Move ${plural(total, 'file')}` : 'Flatten'}</Button>
      </>
    }>
      <p className="muted small">Every file in the subfolders moves into <span className="mono">{path}</span>. Links stay where they are (moving them could break them). Undo puts every file back and recreates the folders.</p>
      <div className="pt-checks">
        <label className="check"><input type="checkbox" checked={spec.removeEmpty} onChange={(e) => setSpec((s) => ({ ...s, removeEmpty: e.target.checked }))} /> Remove the subfolders that are empty afterwards</label>
        <label className="check"><input type="checkbox" checked={spec.includeHidden} onChange={(e) => setSpec((s) => ({ ...s, includeHidden: e.target.checked }))} /> Include hidden files and folders</label>
      </div>
      {error && <p className="error-text">{error}</p>}
      {plan && (
        <>
          <div className="pill-row tight" aria-label="Preview counts">
            <Pill tone="accent">{plural(total, 'file')} to move</Pill>
            <Pill>{plural(plan.folders, 'subfolder')}</Pill>
            {plan.conflicts ? <Pill tone="warning">{plural(plan.conflicts, 'name conflict')}</Pill> : null}
            {spec.removeEmpty && <Pill>{plural(plan.emptyAfter.length, 'folder')} removed</Pill>}
          </div>
          {plan.conflicts ? <p className="small">For each name that is taken you choose <strong>Keep both</strong>, <strong>Skip</strong> or <strong>Replace</strong> (the replaced item goes to the Trash).</p> : null}
          {leftAlone.length > 0 && <p className="muted small">Left where they are: {leftAlone.join(', ')}{spec.removeEmpty ? '; their folders are kept' : ''}.</p>}
          {plan.truncated && <Warn>More than 100,000 files are inside; flatten smaller folders.</Warn>}
          {total > 0 && (
            <div className="pt-table-wrap">
              <table className="pt-table" aria-label="Files to move">
                <thead><tr><th scope="col">File</th><th scope="col">From</th></tr></thead>
                <tbody>{plan.moves.slice(0, 300).map((m) => (
                  <tr key={m.source} className={m.conflict ? 'is-conflict' : ''}>
                    <td><span className="ellipsis" title={m.name}>{m.name}</span>{m.conflict && <Pill tone="warning" title={m.conflict === 'exists' ? 'An item with this name is already in the folder: you will be asked.' : 'Another file in a subfolder has the same name: you will be asked.'}>{m.conflict === 'exists' ? 'name taken' : 'same name twice'}</Pill>}</td>
                    <td><span className="ellipsis mono small" title={m.rel}>{relTo(path, dirOf(m.source)) || '.'}</span></td>
                  </tr>
                ))}</tbody>
              </table>
              {total > 300 && <p className="muted small pt-more">The first 300 of {total.toLocaleString()} files are listed; all of them are moved.</p>}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ set dates

const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};

export function SetDatesDialog({ paths }: { paths: string[] }) {
  const [mode, setMode] = useState<DatesSpec['mode']>('datetime');
  const [when, setWhen] = useState(() => toLocalInput(Math.floor(Date.now() / 60000) * 60000));
  const [modified, setModified] = useState(true);
  const [accessed, setAccessed] = useState(true);
  const [recursive, setRecursive] = useState(false);
  const [caps, setCaps] = useState<{ birthTimeReason: string } | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => void call<{ birthTimeReason: string }>('pt:capabilities').then(setCaps, () => undefined), []);
  const whenMs = new Date(when).getTime();
  const spec: DatesSpec = { mode, datetimeMs: mode === 'datetime' && Number.isFinite(whenMs) ? whenMs : undefined, modified, accessed, recursive };
  const specKey = JSON.stringify(spec);
  const invalid = !modified && !accessed ? 'Choose the modification time, the access time or both.' : mode === 'datetime' && !Number.isFinite(whenMs) ? 'Choose a date and time.' : null;
  const { plan, error, progress, busy } = usePlan<DatesPlan>(invalid ? null : (jobId) => call('pt:datesPlan', { paths, spec, jobId }), [paths, specKey, invalid]);
  const changing = plan?.changing ?? plan?.items.filter((i) => i.next).length ?? 0;
  const go = async () => {
    setStarting(true);
    if (await startVia(() => call('pt:datesStart', { paths, spec }))) closeDialog();
    setStarting(false);
  };
  const hasFolder = plan?.items.some((i) => i.kind === 'directory') ?? false;
  return (
    <Dialog title={`Set dates · ${paths.length === 1 ? base(paths[0]!) : plural(paths.length, 'item')}`} onClose={closeDialog} width={820} className="pt-dialog pt-dates" footer={
      <>
        <Summary>{invalid ?? error ?? (busy || !plan ? progress ?? 'Reading…' : `${plural(changing, 'item')} change${plan.total && plan.total > changing ? `; ${(plan.total - changing).toLocaleString()} left alone` : ''}`)}</Summary>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="setDates" disabled={!!invalid || busy || !plan || !changing || starting} onClick={() => void go()}>{changing ? `Set dates of ${plural(changing, 'item')}` : 'Set dates'}</Button>
      </>
    }>
      <Segmented<DatesSpec['mode']> label="New date" value={mode} onChange={setMode} options={[{ value: 'datetime', label: 'Date and time' }, { value: 'now', label: 'Now' }, { value: 'exif', label: 'Date taken (EXIF)' }, { value: 'filename', label: 'Date in the name' }]} />
      {mode === 'datetime' && (
        <label className="field pt-datetime" htmlFor="pt-dates-when">
          <span className="field-label">Date and time (local)</span>
          <input id="pt-dates-when" className="input" type="datetime-local" step="1" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
      )}
      {mode === 'filename' && <p className="muted small">Recognised: IMG_20240131_101500, PXL_20240131_101500123, 2024-01-31 10.15.00, Screenshot 2024-01-31 at 10.15.00, 2024-01-31, 2024_01_31, 20240131 (read as local time).</p>}
      {mode === 'exif' && <p className="muted small">Uses the photo’s DateTimeOriginal (local camera time). Files without one are left alone.</p>}
      <div className="pt-checks">
        <label className="check"><input type="checkbox" checked={modified} onChange={(e) => setModified(e.target.checked)} /> Modification time</label>
        <label className="check"><input type="checkbox" checked={accessed} onChange={(e) => setAccessed(e.target.checked)} /> Access time</label>
        {(hasFolder || recursive) && <label className="check"><input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Also everything inside the folders</label>}
      </div>
      {caps && <p className="muted small">Creation time is not changed: {caps.birthTimeReason}</p>}
      {error && <p className="error-text">{error}</p>}
      {plan && (
        <div className="pt-table-wrap">
          <table className="pt-table pt-dates-table" aria-label="Dates before and after">
            <thead><tr><th scope="col">Item</th><th scope="col">Modified</th><th scope="col">New date</th><th scope="col" className="pt-col-source">From</th></tr></thead>
            <tbody>{plan.items.slice(0, 500).map((i) => (
              <tr key={i.path} className={i.next ? '' : 'is-skip'}>
                <td><span className="ellipsis" title={i.path}><Icon name={i.kind === 'directory' ? 'folder' : 'file'} size={12} /> {relTo(dirOf(paths[0]!), i.path) || i.name}</span></td>
                <td className="tabular small">{i.kind === 'other' && !i.mtimeMs ? '—' : formatDate(i.mtimeMs)}</td>
                <td className="tabular small">{i.next ? <strong>{formatDate(modified ? i.next.mtimeMs : i.next.atimeMs)}</strong> : <span className="muted">{i.reason}</span>}</td>
                <td className="small muted pt-col-source"><span className="ellipsis" title={i.source}>{i.next ? i.source ?? (mode === 'now' ? 'now' : 'chosen date') : ''}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {(plan.total ?? plan.items.length) > 500 && <p className="muted small pt-more">The first 500 of {(plan.total ?? plan.items.length).toLocaleString()} items are listed.</p>}
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ links

const linkName = (name: string, sameFolder: boolean, kind: 'hard' | 'junction') => {
  if (!sameFolder) return name;
  const dot = name.lastIndexOf('.');
  const suffix = kind === 'hard' ? ' (hard link)' : ' (junction)';
  return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
};

export function LinkDialog({ kind, paths, dir }: { kind: 'hard' | 'junction'; paths: string[]; dir?: string }) {
  const sourceDir = dirOf(paths[0]!);
  const [dest, setDest] = useState(dir ?? sourceDir);
  const same = (d: string) => paths.every((p) => dirOf(p) === d);
  const [name, setName] = useState(() => linkName(base(paths[0]!), same(dir ?? sourceDir), kind));
  const [nameError, setNameError] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const single = paths.length === 1;
  useEffect(() => {
    if (!single) return;
    let live = true;
    void call<{ valid: boolean; reason?: string }>('fs:validateName', { parent: dest, name }).then((r) => live && setNameError(r.reason), () => undefined);
    return () => {
      live = false;
    };
  }, [dest, name, single]);
  const onDest = (d: string) => {
    setDest(d);
    if (single) setName(linkName(base(paths[0]!), same(d), kind));
  };
  const items = single ? [{ target: paths[0]!, name }] : paths.map((p) => ({ target: p, name: linkName(base(p), same(dest), kind) }));
  const go = async () => {
    setStarting(true);
    if (await startVia(() => call('pt:linkStart', { destination: dest, params: { kind, items } }))) closeDialog();
    setStarting(false);
  };
  const noun = kind === 'hard' ? 'hard link' : 'junction';
  return (
    <Dialog title={single ? `Create ${noun} to ${base(paths[0]!)}` : `Create ${plural(paths.length, noun)}`} onClose={closeDialog} width={540} className="pt-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="hardLink" disabled={starting || (single && (!!nameError || !name.trim()))} onClick={() => void go()}>{single ? `Create ${noun}` : `Create ${plural(paths.length, noun)}`}</Button>
      </>
    }>
      {kind === 'hard'
        ? <p className="muted small">A hard link is a second name for the same file: both show the same contents, changes through one appear in the other, and the data stays until every name is deleted. It works only on the same drive and for files (not folders).</p>
        : <p className="muted small">A junction is a Windows folder link that needs no administrator rights. Junction support has not been tested on Windows.</p>}
      <FolderPicker id="pt-link-dest" label="Create in" value={dest} onChange={onDest} />
      {single
        ? <TextField id="pt-link-name" label="Name" value={name} error={nameError} onChange={(e) => setName(e.target.value)} />
        : <ul className="confirm-detail mono">{items.slice(0, 12).map((i) => <li key={i.target}>{i.name}</li>)}{items.length > 12 && <li>…and {items.length - 12} more</li>}</ul>}
      <p className="muted small">Names that are taken are never replaced; you choose Keep both or Skip.</p>
    </Dialog>
  );
}

// ------------------------------------------------------------------ paste image / text

function useFileName(dir: string, initial: string, check?: (v: string) => string | undefined) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    const own = check?.(name);
    if (own) {
      setError(own);
      return;
    }
    const t = setTimeout(() => void call<{ valid: boolean; reason?: string }>('fs:validateName', { parent: dir, name }).then((r) => live && setError(r.reason), () => undefined), 100);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [dir, name, check]);
  return { name, setName, error };
}

const pngCheck = (v: string) => (/\.png$/i.test(v) ? undefined : 'Images are saved as PNG; the name must end in .png.');

export function PasteImageDialog({ dir }: { dir: string }) {
  const [info, setInfo] = useState<{ width: number; height: number; thumb: string } | null | undefined>(undefined);
  const f = useFileName(dir, defaultPasteName('image', 'png'), pngCheck);
  const [starting, setStarting] = useState(false);
  useEffect(() => void call<{ width: number; height: number; thumb: string } | null>('clip:imageInfo').then(setInfo, () => setInfo(null)), []);
  useEffect(() => {
    // Select the name without ".png" once, when the dialog opens, so typing replaces it.
    const el = document.getElementById('pt-paste-image-name') as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, Math.max(0, el.value.length - 4));
  }, []);
  const go = async () => {
    if (f.error || !info) return;
    setStarting(true);
    if (await startVia(() => call('clip:pasteImage', { dir, name: f.name }))) closeDialog();
    setStarting(false);
  };
  return (
    <Dialog title="Paste image as file" onClose={closeDialog} width={520} className="pt-dialog pt-paste" footer={
      <>
        <Summary>{info ? `${info.width} × ${info.height} pixels · PNG` : info === null ? 'The clipboard holds no image.' : 'Reading the clipboard…'}</Summary>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="pasteImage" disabled={!info || !!f.error || starting} onClick={() => void go()}>Save image</Button>
      </>
    }>
      {info && <div className="pt-thumb"><img src={info.thumb} alt={`Clipboard image, ${info.width} by ${info.height} pixels`} /></div>}
      {info === null && <p className="error-text">The clipboard no longer holds an image.</p>}
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <TextField id="pt-paste-image-name" label={`File name (in ${base(dir)})`} value={f.name} error={f.error} onChange={(e) => f.setName(e.target.value)} hint={info ? `${info.width} × ${info.height} pixels, saved as a PNG file` : undefined} />
      </form>
    </Dialog>
  );
}

const FORMAT_LABEL: Record<PasteTextFormat, string> = { txt: 'Text (.txt)', md: 'Markdown (.md)', json: 'JSON (.json)', csv: 'CSV (.csv)' };

export function PasteTextDialog({ dir }: { dir: string }) {
  const [peek, setPeek] = useState<ClipPeek | null | undefined>(undefined);
  const [format, setFormat] = useState<PasteTextFormat>('txt');
  const stemRef = useRef(defaultPasteName('text', 'txt').replace(/\.txt$/, ''));
  const f = useFileName(dir, `${stemRef.current}.txt`);
  const [starting, setStarting] = useState(false);
  useEffect(() => void refreshClipboard(true).then((p) => {
    setPeek(p);
    if (p?.text?.json) {
      setFormat('json');
      f.setName(`${stemRef.current}.json`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const changeFormat = (v: PasteTextFormat) => {
    setFormat(v);
    const stem = f.name.replace(/\.(txt|md|json|csv)$/i, '');
    stemRef.current = stem || stemRef.current;
    f.setName(`${stemRef.current}.${v}`);
  };
  const text = peek?.text;
  const go = async () => {
    if (f.error || !text) return;
    setStarting(true);
    if (await startVia(() => call('clip:pasteText', { dir, name: f.name }))) closeDialog();
    setStarting(false);
  };
  return (
    <Dialog title="Paste text as file" onClose={closeDialog} width={600} className="pt-dialog pt-paste" footer={
      <>
        <Summary>{text ? `${plural(text.length, 'character')} · ${plural(text.lines, 'line')} · UTF-8` : peek === undefined ? 'Reading the clipboard…' : 'The clipboard holds no text.'}</Summary>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="pasteText" disabled={!text || !!f.error || starting} onClick={() => void go()}>Save text</Button>
      </>
    }>
      <Segmented<PasteTextFormat> label="File type" value={format} onChange={changeFormat} options={PASTE_TEXT_FORMATS.map((x) => ({ value: x, label: FORMAT_LABEL[x] }))} />
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <TextField id="pt-paste-text-name" label={`File name (in ${base(dir)})`} value={f.name} error={f.error} onChange={(e) => f.setName(e.target.value)} hint="Saved as UTF-8, exactly as copied." autoFocus />
      </form>
      {format === 'json' && text && !text.json && <Warn>This text is not valid JSON. It is saved exactly as it is.</Warn>}
      {text && (
        <div>
          <p className="field-label">Preview{text.length > text.preview.length ? ` (the first ${text.preview.length} characters)` : ''}</p>
          <pre className="pt-text-preview" tabIndex={0} aria-label="Clipboard text preview">{text.preview}</pre>
        </div>
      )}
      {peek !== undefined && !text && <p className="error-text">The clipboard no longer holds text.</p>}
    </Dialog>
  );
}

// ------------------------------------------------------------------ clipboard history

const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  const clock = new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (s < 60) return `just now · ${clock}`;
  if (s < 3600) return `${Math.round(s / 60)} min ago · ${clock}`;
  return formatDate(ms);
};

interface ClipPinEntry { id: string; mode: 'copy' | 'cut'; paths: string[]; label: string | null; pinnedMs: number }

export function ClipboardHistoryDialog({ dir }: { dir?: string }) {
  const [entries, setEntries] = useState<ClipHistoryEntry[] | null>(null);
  const [pins, setPins] = useState<ClipPinEntry[]>([]);
  const load = () => {
    void call<ClipHistoryEntry[]>('clip:history').then(setEntries, (e) => {
      toastError(e);
      setEntries([]);
    });
    void call<ClipPinEntry[]>('clip:pins').then(setPins, () => setPins([]));
  };
  useEffect(load, []);
  // Once the list is there, the keyboard starts on the newest set that can be pasted.
  const listRef = useRef<HTMLUListElement>(null);
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!entries?.length || focusedOnce.current) return;
    focusedOnce.current = true;
    listRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [entries]);
  const paste = async (e: ClipHistoryEntry | ClipPinEntry, mode: 'copy' | 'move') => {
    if (!dir) return;
    try {
      const paths = 'firstNames' in e
        ? (await call<{ mode: 'copy' | 'cut'; paths: string[]; missing: number }>('clip:historyItems', { id: e.id })).paths
        : (e as ClipPinEntry).paths;
      if (!paths.length) {
        toast({ level: 'warning', title: 'None of these items exists any more.' });
        load();
        return;
      }
      const rec = await startTransfer(paths, dir, mode, 'paste-history');
      if (rec) {
        closeDialog();
      }
    } catch (err) {
      toastError(err);
    }
  };
  const pinEntry = async (e: ClipHistoryEntry) => {
    try {
      const items = await call<{ mode: 'copy' | 'cut'; paths: string[]; missing: number }>('clip:historyItems', { id: e.id });
      await call('clip:pin', { id: e.id, mode: items.mode, paths: items.paths });
      toast({ level: 'success', title: 'Pinned to clipboard history' });
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const unpinEntry = async (id: string) => {
    await call('clip:unpin', { id }).catch(toastError);
    load();
  };
  const clear = async () => {
    await call('clip:clearHistory').catch(toastError);
    load();
  };
  const pinnedIds = new Set(pins.map((p) => p.id));
  return (
    <Dialog title="Clipboard history" onClose={closeDialog} width={640} className="pt-dialog pt-history" footer={
      <>
        <Summary>{dir ? <>Pastes into <span className="mono">{base(dir)}</span></> : 'Open a folder to paste into.'}</Summary>
        <Button onClick={() => void clear()} disabled={!entries?.length}>Clear history</Button>
        <Button onClick={closeDialog}>Close</Button>
      </>
    }>
      <p className="muted small">The last 10 sets of files copied or cut this session, plus pinned entries (saved permanently).</p>
      {pins.length > 0 && (
        <>
          <p className="small" style={{ fontWeight: 600, margin: '8px 0 4px' }}>Pinned</p>
          <ul className="pt-history-list" aria-label="Pinned clipboard entries">
            {pins.map((p) => (
              <li key={p.id} className="pt-history-item">
                <div className="pt-history-main">
                  <div className="pt-history-head">
                    <Icon name="pin" size={14} />
                    <strong>{p.mode === 'cut' ? 'Cut' : 'Copied'} {plural(p.paths.length, 'item')}</strong>
                    <span className="muted small">{ago(p.pinnedMs)}</span>
                  </div>
                  <span className="ellipsis small mono" title={p.paths.map((x) => x.split('/').pop() ?? x).join(', ')}>
                    {p.paths.slice(0, 5).map((x) => x.split('/').pop() ?? x).join(', ')}{p.paths.length > 5 ? ` and ${p.paths.length - 5} more` : ''}
                  </span>
                </div>
                <div className="pt-history-actions">
                  <Button size="sm" variant="primary" disabled={!dir} onClick={() => void paste(p, 'copy')}>Paste copy</Button>
                  <Button size="sm" variant="ghost" onClick={() => void unpinEntry(p.id)}>Unpin</Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {entries === null ? <p className="muted small" role="status">Loading…</p> : !entries.length && !pins.length ? (
        <p className="muted">Nothing has been copied or cut since Orbis Files started.</p>
      ) : entries.length > 0 && (
        <>
          {pins.length > 0 && <p className="small" style={{ fontWeight: 600, margin: '8px 0 4px' }}>Recent</p>}
          <ul ref={listRef} className="pt-history-list" aria-label="Copied and cut file sets, newest first">
            {entries.map((e) => {
              const allMissing = e.missing >= e.count - e.remote && e.remote === 0;
              return (
                <li key={e.id} className={`pt-history-item ${allMissing ? 'is-missing' : ''}`}>
                  <div className="pt-history-main">
                    <div className="pt-history-head">
                      <Icon name={e.mode === 'cut' ? 'cut' : 'copy'} size={14} />
                      <strong>{e.mode === 'cut' ? 'Cut' : 'Copied'} {plural(e.count, 'item')}</strong>
                      <span className="muted small">{ago(e.timeMs)}</span>
                      {e.missing > 0 && <Pill tone={allMissing ? 'error' : 'warning'}>{allMissing ? 'all missing' : `${e.missing} missing`}</Pill>}
                    </div>
                    <span className="ellipsis small mono" title={e.firstNames.join(', ')}>{e.firstNames.join(', ')}{e.count > e.firstNames.length ? ` and ${e.count - e.firstNames.length} more` : ''}</span>
                  </div>
                  <div className="pt-history-actions">
                    {!pinnedIds.has(e.id) && <Button size="sm" variant="ghost" onClick={() => void pinEntry(e)} title="Pin this entry permanently">Pin</Button>}
                    <Button size="sm" variant={e.mode === 'copy' ? 'primary' : 'default'} disabled={!dir || allMissing} onClick={() => void paste(e, 'copy')} aria-label={`Paste copies of ${e.firstNames[0] ?? 'the items'}${e.count > 1 ? ` and ${e.count - 1} more` : ''} here`}>Paste copy</Button>
                    {e.mode === 'cut' && <Button size="sm" variant="primary" disabled={!dir || allMissing} onClick={() => void paste(e, 'move')} aria-label={`Move ${e.firstNames[0] ?? 'the items'}${e.count > 1 ? ` and ${e.count - 1} more` : ''} here`}>Move here</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ host

/** Renders the 'pt.*' dialogs (one line in Dialogs.tsx). */
export function PowerToolsDialog({ id, props }: { id: string; props: Record<string, unknown> }) {
  switch (id) {
    case 'pt.split': return <SplitDialog path={props.path as string} name={props.name as string} size={Number(props.size ?? 0)} dir={props.dir as string | undefined} />;
    case 'pt.join': return <JoinDialog path={props.path as string} />;
    case 'pt.shred': return <ShredDialog paths={props.paths as string[]} names={props.names as string[]} />;
    case 'pt.flatten': return <FlattenDialog path={props.path as string} />;
    case 'pt.dates': return <SetDatesDialog paths={props.paths as string[]} />;
    case 'pt.link': return <LinkDialog kind={props.kind as 'hard' | 'junction'} paths={props.paths as string[]} dir={props.dir as string | undefined} />;
    case 'pt.pasteImage': return <PasteImageDialog dir={props.dir as string} />;
    case 'pt.pasteText': return <PasteTextDialog dir={props.dir as string} />;
    case 'pt.clipHistory': return <ClipboardHistoryDialog dir={props.dir as string | undefined} />;
    default: return null;
  }
}
