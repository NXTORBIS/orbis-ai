import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, errorShape, runJob } from '../../api';
import { app, confirm, prompt, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane } from '../../state/workspace';
import { Button, Dialog, EmptyState, ErrorState, Pill, ProgressBar, Segmented, Select, TextField, Toggle } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatCount, formatDate, formatTimeOfDay } from '../../ui/format';
import { watchOperation } from '../../actions';
import { FolderPicker, JobPauseButton, useJobPaused } from './common';
import {
  DEFAULT_SYNC_OPTIONS,
  type ConflictChoice,
  type SyncAction,
  type SyncActionKind,
  type SyncMode,
  type SyncOptions,
  type SyncPair,
  type SyncPlan,
} from '../../../shared/sync';
import type { OperationRecord } from '../../../shared/operations';
import { describeSchedule, ScheduleSchema, type Schedule } from '../../../shared/schedule';
import { schedules } from '../../state/backups';
import { ScheduleFields } from './BackupDialogs';

/** Schedule of a saved pair (main: sync/SyncSchedules.ts). */
interface PairSchedule {
  pairId: string;
  schedule: Schedule;
  maxDeletes: number;
  approvedMs?: number;
  needsApproval: boolean;
  lastRunMs?: number;
  lastResult?: { ms: number; outcome: string; message: string };
  nextRunMs?: number;
  running: boolean;
}

/**
 * Synchronize folders: saved pairs, mode and options, a preview grouped by
 * action, per-conflict decisions, then a 'sync' operation that reports its
 * progress in the Operations panel like any other file operation.
 */

const MODES: Array<{ value: SyncMode; label: string; help: string }> = [
  { value: 'mirror', label: 'Mirror', help: 'Makes the right folder an exact copy of the left: copies new and changed items, and moves items that are not on the left to the Trash.' },
  { value: 'update', label: 'Update', help: 'Copies new and changed items from left to right. Never deletes anything.' },
  { value: 'two-way', label: 'Two-way', help: 'Copies changes in both directions, including deletions (to the Trash), by comparing with the state stored after the last run. Changes made on both sides are conflicts you decide.' },
];

const GROUPS: Array<{ kind: SyncActionKind; title: string }> = [
  { kind: 'conflict', title: 'Conflicts' },
  { kind: 'copy', title: 'Copy' },
  { kind: 'update', title: 'Update' },
  { kind: 'delete', title: 'Move to Trash' },
];

const TOLERANCES = [
  { value: '1', label: 'Exact (1 ms)' },
  { value: '1000', label: '1 second' },
  { value: '2000', label: '2 seconds (FAT, network drives)' },
  { value: '5000', label: '5 seconds' },
];

const ROWS_STEP = 200;
const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted']);

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const splitPatterns = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function choiceLabel(a: SyncAction, c: ConflictChoice, mode: SyncMode): string {
  if (c === 'skip') return 'Skip (leave both as they are)';
  if (c === 'both') return mode === 'two-way' ? 'Keep both (rename the right copy)' : 'Keep both (rename the target copy)';
  if (c === 'left') {
    if (!a.left) return 'Delete on the right too';
    return mode === 'two-way' ? 'Keep left' : 'Use the source version';
  }
  if (!a.right) return 'Delete on the left too';
  return 'Keep right';
}

function sideText(e: SyncAction['left']): string {
  if (!e) return 'not there';
  const size = e.kind === 'file' ? formatBytes(e.size) : e.kind === 'directory' ? 'folder' : `link → ${e.linkTarget ?? '?'}`;
  return `${size} · ${formatDate(e.mtimeMs)}`;
}

export function SyncView() {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const startDir = (() => {
    const l = activePane().history[activePane().index];
    return l?.kind === 'fs' ? l.path : home;
  })();
  const [pairs, setPairs] = useState<SyncPair[] | null>(null);
  const [pairId, setPairId] = useState<string | undefined>();
  const [left, setLeft] = useState(startDir);
  const [right, setRight] = useState(home);
  const [mode, setMode] = useState<SyncMode>('update');
  const [opts, setOpts] = useState<SyncOptions>(DEFAULT_SYNC_OPTIONS);
  const [includeText, setIncludeText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [planKey, setPlanKey] = useState('');
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  const [progress, setProgress] = useState<{ stage: string; done: number; total?: number } | null>(null);
  const [error, setError] = useState<{ message: string; errorId?: string } | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ConflictChoice>>({});
  const [opId, setOpId] = useState<string | null>(null);
  const op = useStore(app, (s) => (opId ? s.ops[opId] : undefined));

  const options: SyncOptions = useMemo(() => ({ ...opts, include: splitPatterns(includeText), exclude: splitPatterns(excludeText) }), [opts, includeText, excludeText]);
  const inputKey = JSON.stringify({ left, right, mode, options });
  const outdated = !!plan && planKey !== inputKey;
  const oneWay = mode !== 'two-way';
  const loadedPair = pairs?.find((p) => p.id === pairId);

  const schedSeq = useStore(schedules, (st) => st.seq);
  const schedPaused = useStore(schedules, (st) => !!st.status?.paused);
  const [pairSchedules, setPairSchedules] = useState<Record<string, PairSchedule>>({});
  const [scheduling, setScheduling] = useState<SyncPair | null>(null);
  const [approve, setApprove] = useState(true);
  const loadPairs = useCallback(() => {
    call<SyncPair[]>('sync:pairs').then(setPairs, toastError);
    call<PairSchedule[]>('sync:schedules').then((list) => setPairSchedules(Object.fromEntries(list.map((x) => [x.pairId, x]))), () => undefined);
  }, []);
  useEffect(loadPairs, [loadPairs, schedSeq]);
  const opDone = !!op && TERMINAL.has(op.state);
  useEffect(() => {
    if (opDone) loadPairs();
  }, [opDone, loadPairs]);

  const fill = (p: SyncPair) => {
    setPairId(p.id);
    setLeft(p.left);
    setRight(p.right);
    setMode(p.mode);
    setOpts(p.options);
    setIncludeText(p.options.include.join(', '));
    setExcludeText(p.options.exclude.join(', '));
    setPlan(null);
    setOpId(null);
    setError(null);
  };

  const preview = (input?: { left: string; right: string; mode: SyncMode; options: SyncOptions; pairId?: string }) => {
    const req = input ?? { left, right, mode, options, pairId };
    setPlan(null);
    setError(null);
    setDecisions({});
    setOpId(null);
    setProgress({ stage: 'scanning', done: 0 });
    const key = JSON.stringify({ left: req.left, right: req.right, mode: req.mode, options: req.options });
    const j = runJob<SyncPlan>((jobId) => call('sync:preview', { ...req, jobId }), (p) => setProgress(p as typeof progress), `Sync preview · ${baseName(req.left)} → ${baseName(req.right)}`);
    setJob({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then(
      (r) => {
        setJob(null);
        setProgress(null);
        if (r.value) {
          setPlan(r.value);
          setPlanKey(key);
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

  const savePair = async (asNew: boolean) => {
    const id = asNew ? undefined : pairId;
    const name = id && loadedPair ? loadedPair.name : await prompt({ title: 'Save sync pair', label: 'Name', initial: `${baseName(left)} → ${baseName(right)}`, confirmLabel: 'Save' });
    if (!name) return;
    const saved = await call<SyncPair>('sync:savePair', { id, name, left, right, mode, options }).catch((err) => {
      toastError(err, 'Could not save the sync pair');
      return undefined;
    });
    if (!saved) return;
    setPairId(saved.id);
    loadPairs();
    toast({ level: 'success', title: id ? `Saved changes to “${saved.name}”` : `Saved sync pair “${saved.name}”` });
  };

  const deletePair = async (p: SyncPair) => {
    const ok = await confirm({ title: `Delete sync pair “${p.name}”?`, body: 'Only the saved pair is removed. Both folders and every file in them stay exactly as they are.', confirmLabel: 'Delete pair' });
    if (!ok) return;
    await call('sync:deletePair', { id: p.id }).catch(toastError);
    if (pairId === p.id) setPairId(undefined);
    loadPairs();
  };

  const forgetBaseline = async () => {
    const ok = await confirm({
      title: 'Forget the stored synchronization state?',
      body: 'The next two-way run treats these folders as never synchronized: missing items are copied both ways, nothing is deleted, and items that differ become conflicts. No files are changed now.',
      confirmLabel: 'Forget state',
    });
    if (!ok) return;
    await call('sync:forgetBaseline', { left, right }).then(() => preview(), toastError);
  };

  const conflicts = useMemo(() => plan?.actions.filter((a) => a.action === 'conflict') ?? [], [plan]);
  // A preview of a saved, scheduled pair exactly as saved can approve it for scheduled runs.
  const pairSched = pairId ? pairSchedules[pairId] : undefined;
  const approvable = !!plan && !outdated && !!loadedPair && !!pairSched?.needsApproval && left === loadedPair.left && right === loadedPair.right && mode === loadedPair.mode && JSON.stringify(options) === JSON.stringify(loadedPair.options);
  const chosen = (a: SyncAction): ConflictChoice => decisions[a.id] ?? 'skip';

  const synchronize = async () => {
    if (!plan) return;
    const deletes = plan.actions.filter((a) => a.action === 'delete');
    const replaced = plan.options.trashReplaced ? plan.groups.update.count + conflicts.filter((a) => (chosen(a) === 'left' && a.right && a.left) || (chosen(a) === 'right' && a.left && a.right)).length : 0;
    const conflictDeletes = conflicts.filter((a) => (chosen(a) === 'left' && !a.left) || (chosen(a) === 'right' && !a.right)).length;
    const toTrash = plan.groups.delete.count + replaced + conflictDeletes;
    const undecided = conflicts.filter((a) => chosen(a) === 'skip').length;
    if (toTrash > 0) {
      const inside = deletes.reduce((n, a) => n + (a.items ?? 0), 0);
      const parts = [
        plan.groups.delete.count + conflictDeletes ? `${formatCount(plan.groups.delete.count + conflictDeletes, 'item')} ${oneWay ? 'not in the source' : 'deleted on the other side'}${inside ? ` (folders with ${formatCount(inside, 'item')} inside)` : ''}` : '',
        replaced ? `${formatCount(replaced, 'replaced version')}` : '',
      ].filter(Boolean);
      const ok = await confirm({
        title: `Synchronize and move ${formatCount(toTrash, 'item')} to the Trash?`,
        body: `${parts.join(' and ')} will be moved to the Trash, where they can be restored. Nothing is deleted permanently.${undecided ? ` ${formatCount(undecided, 'conflict')} without a decision will be skipped.` : ''}`,
        confirmLabel: 'Synchronize',
        detail: deletes.slice(0, 8).map((a) => `${a.to === 'left' ? 'Left' : 'Right'}: ${a.rel}${a.kind === 'directory' ? '/' : ''}`),
      });
      if (!ok) return;
    }
    const list = Object.entries(decisions).filter(([, c]) => c !== 'skip').map(([id, choice]) => ({ id: Number(id), choice }));
    // A pair saved (or loaded) after this preview records the run too; the main process checks that it describes the same folders and mode.
    const rec = await call<OperationRecord>('sync:run', { planId: plan.planId, decisions: list, ...(pairId ? { pairId } : {}), ...(approvable && approve ? { approveSchedule: true } : {}) }).catch((err) => {
      toastError(err, 'Could not start the synchronization');
      return undefined;
    });
    if (!rec) return;
    watchOperation(rec.id);
    setOpId(rec.id);
    app.set({ opsPanelOpen: true });
  };

  const isNested = useMemo(() => {
    if (!left || !right || left === right) return false;
    const l = left.endsWith('/') ? left : left + '/';
    const r = right.endsWith('/') ? right : right + '/';
    return r.startsWith(l) || l.startsWith(r);
  }, [left, right]);
  const modeHelp = MODES.find((m) => m.value === mode)!.help;
  const approveOnly = async () => {
    if (!plan || !pairId) return;
    await call('sync:approveSchedule', { planId: plan.planId, pairId }).then(() => {
      toast({ level: 'success', title: 'Approved for scheduled runs', detail: 'Scheduled runs use exactly these folders, mode and options, and stop on conflicts or too many deletions.' });
      loadPairs();
    }, toastError);
  };
  const running = !!op && !TERMINAL.has(op.state);
  const actionable = plan ? plan.actions.length - conflicts.filter((a) => chosen(a) === 'skip').length : 0;
  const blockedByTrash = !!plan && !plan.trashAvailable && (plan.groups.delete.count > 0 || (plan.options.trashReplaced && plan.groups.update.count > 0));

  return (
    <div className="tool-view scroll-y sync-view">
      <header className="view-header">
        <h1>Synchronize folders</h1>
        <p className="muted">Compares two folders and shows every change before anything happens. Copies are written to a temporary file and checked before they replace anything; deleted and replaced items go to the Trash.</p>
      </header>

      <section className="home-section" aria-labelledby="sync-pairs-h">
        <div className="section-head"><h2 id="sync-pairs-h">Saved sync pairs</h2></div>
        {pairs === null ? <p className="muted small">Loading…</p> : !pairs.length ? (
          <p className="muted small">No saved pairs yet. Choose two folders below and use “Save as pair…” to keep the folders, mode and options for next time.</p>
        ) : (
          <ul className="rule-list sync-pairs" aria-label="Saved sync pairs">
            {pairs.map((p) => (
              <li key={p.id} className={`rule sync-pair ${p.id === pairId ? 'is-current' : ''}`}>
                <div className="rule-main">
                  <strong>{p.name} <Pill tone="accent">{MODES.find((m) => m.value === p.mode)?.label}</Pill></strong>
                  <span className="mono muted ellipsis" title={`${p.left} → ${p.right}`}>{p.left} {p.mode === 'two-way' ? '⇄' : '→'} {p.right}</span>
                  <span className="muted small">
                    {p.lastSummary
                      ? `Last run ${formatDate(p.lastRunMs)} · ${p.lastSummary.state === 'completed' ? 'completed' : p.lastSummary.state.replace(/_/g, ' ')} · ${p.lastSummary.done} done${p.lastSummary.skipped ? `, ${p.lastSummary.skipped} skipped` : ''}${p.lastSummary.failed ? `, ${p.lastSummary.failed} failed` : ''}`
                      : 'Never run'}
                  </span>
                  {pairSchedules[p.id] && <PairScheduleLine s={pairSchedules[p.id]!} paused={schedPaused} />}
                </div>
                <div className="row-actions">
                  <Button size="sm" variant="primary" disabled={!!job || running} onClick={() => {
                    fill(p);
                    preview({ left: p.left, right: p.right, mode: p.mode, options: p.options, pairId: p.id });
                  }}>Preview</Button>
                  <Button size="sm" onClick={() => fill(p)} aria-label={`Edit ${p.name}`}>Edit</Button>
                  <Button size="sm" icon="schedule" onClick={() => setScheduling(p)} aria-label={`Schedule ${p.name}`}>Schedule…</Button>
                  <Button size="sm" variant="ghost" onClick={() => void deletePair(p)} aria-label={`Delete ${p.name}`}>Delete…</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-section" aria-labelledby="sync-setup-h">
        <div className="section-head">
          <h2 id="sync-setup-h">{loadedPair ? `Editing “${loadedPair.name}”` : 'Folders and mode'}</h2>
          {loadedPair && <Button size="sm" variant="ghost" onClick={() => setPairId(undefined)}>Stop editing</Button>}
        </div>
        <div className="tool-controls two">
          <FolderPicker value={left} onChange={setLeft} label={oneWay ? 'Source (left)' : 'Left folder'} id="sync-left" />
          <FolderPicker value={right} onChange={setRight} label={oneWay ? 'Target (right)' : 'Right folder'} id="sync-right" />
        </div>
        <div className="sync-mode">
          <Segmented<SyncMode> label="Synchronization mode" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: m.label }))} />
          <p className="sync-mode-help" aria-live="polite">{modeHelp}</p>
        </div>
        <fieldset className="sync-options">
          <legend>Options</legend>
          <div className="sync-option-grid">
            <TextField id="sync-include" label="Include only" mono placeholder="*.jpg, photos/" value={includeText} onChange={(e) => setIncludeText(e.target.value)} hint="Patterns separated by commas. Empty: everything." />
            <TextField id="sync-exclude" label="Exclude" mono placeholder="*.tmp, node_modules/, .git/" value={excludeText} onChange={(e) => setExcludeText(e.target.value)} hint="Matching items are left alone on both sides." />
            <Select<string> id="sync-tolerance" label="Treat modification times as equal within" value={String(opts.mtimeToleranceMs)} options={TOLERANCES.some((t) => t.value === String(opts.mtimeToleranceMs)) ? TOLERANCES : [...TOLERANCES, { value: String(opts.mtimeToleranceMs), label: `${opts.mtimeToleranceMs} ms` }]} onChange={(v) => setOpts({ ...opts, mtimeToleranceMs: Number(v) })} />
            <Select<SyncOptions['symlinks']> id="sync-links" label="Symbolic links (never followed)" value={opts.symlinks} options={[{ value: 'skip', label: 'Leave links alone' }, { value: 'copy-as-link', label: 'Copy links as links' }]} onChange={(v) => setOpts({ ...opts, symlinks: v })} />
          </div>
          <Toggle id="sync-verify" label="Verify contents (SHA-256)" description="Compares file contents when size and time do not settle it, and re-reads every copy to check it. Slower." checked={opts.verify} onChange={(v) => setOpts({ ...opts, verify: v })} />
          <Toggle id="sync-hidden" label="Skip hidden items" description="Leaves items whose name starts with a dot alone on both sides." checked={opts.skipHidden} onChange={(v) => setOpts({ ...opts, skipHidden: v })} />
          <Toggle id="sync-trash-replaced" label="Move replaced versions to the Trash" description="When a newer copy replaces a file, the old version goes to the Trash instead of being overwritten." checked={opts.trashReplaced} onChange={(v) => setOpts({ ...opts, trashReplaced: v })} />
        </fieldset>
        <div className="sync-actions">
          {job ? (
            <>
              <JobPauseButton jobId={job.jobId} />
              <Button onClick={job.cancel}>Stop</Button>
            </>
          ) : (
            <Button variant="primary" icon="search" disabled={!left || !right || left === right || isNested || running} onClick={() => preview()}>Preview</Button>
          )}
          {loadedPair && <Button disabled={!left || !right || left === right} onClick={() => void savePair(false)}>Save changes</Button>}
          <Button variant="ghost" disabled={!left || !right || left === right} title={left === right ? 'Choose two different folders first.' : undefined} onClick={() => void savePair(true)}>Save as pair…</Button>
          {left === right && <span className="muted small">Choose two different folders.</span>}
          {isNested && <span className="warning-text small">One folder is inside the other. Synchronizing nested folders can cause loops or data loss.</span>}
          {mode === 'two-way' && plan?.baseline && !outdated && <Button variant="ghost" onClick={() => void forgetBaseline()}>Forget stored state…</Button>}
        </div>
      </section>

      {progress && (
        <div className="tool-progress" role="status">
          <ProgressBar label="Preparing the preview" value={progress.stage === 'comparing' && progress.total ? progress.done / progress.total : undefined} tone={paused ? 'warning' : 'accent'} />
          <span className="tabular">{paused ? 'Paused · ' : ''}{progress.stage === 'comparing' ? `Comparing · ${progress.done.toLocaleString()} of ${(progress.total ?? 0).toLocaleString()}` : `Reading folders · ${formatCount(progress.done, 'item')}`}</span>
        </div>
      )}
      {error && <ErrorState title="The preview could not be made" body={error.message} errorId={error.errorId} />}
      {op && <RunResult op={op} onPreviewAgain={() => preview()} />}
      {plan && !op && (
        <PlanView
          plan={plan}
          outdated={outdated}
          decisions={decisions}
          setDecisions={setDecisions}
          actionable={actionable}
          blockedByTrash={blockedByTrash}
          onSynchronize={() => void synchronize()}
          onPreviewAgain={() => preview()}
          approval={approvable ? { approve, setApprove, onApproveOnly: () => void approveOnly() } : undefined}
        />
      )}
      {scheduling && <PairScheduleDialog pair={scheduling} current={pairSchedules[scheduling.id]} onClose={() => setScheduling(null)} onSaved={() => {
        setScheduling(null);
        loadPairs();
      }} />}
      {!plan && !progress && !error && !op && (
        <EmptyState icon="sync" title="Choose two folders and preview" body="Nothing is changed until you review the preview and choose Synchronize." />
      )}
    </div>
  );
}

function RunResult({ op, onPreviewAgain }: { op: OperationRecord; onPreviewAgain: () => void }) {
  const done = TERMINAL.has(op.state);
  const s = op.summary;
  const tone = op.state === 'completed' ? 'success' : op.state === 'completed_with_errors' || op.state === 'cancelled' ? 'warning' : op.state === 'failed' || op.state === 'interrupted' ? 'error' : 'accent';
  const label = { completed: 'Synchronized', completed_with_errors: 'Finished with errors', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }[op.state as string] ?? 'Synchronizing…';
  const p = op.progress;
  const failures = op.results.filter((r) => r.status === 'failed');
  return (
    <section className="sync-result" aria-live="polite" aria-label="Synchronization result">
      <div className="sync-result-head">
        <strong>{label}</strong>
        <Pill tone={tone}>{op.state.replace(/_/g, ' ')}</Pill>
        <span className="spacer" />
        {!done && <Button size="sm" icon="activity" onClick={() => app.set({ opsPanelOpen: true })}>Show in Operations</Button>}
        {done && <Button size="sm" variant="primary" onClick={onPreviewAgain}>Preview again</Button>}
      </div>
      {!done && (
        <>
          <ProgressBar label="Synchronization progress" value={p.totalBytes ? p.completedBytes / p.totalBytes : p.totalItems ? p.completedItems / p.totalItems : undefined} tone={op.state === 'paused' ? 'warning' : 'accent'} />
          <span className="muted small tabular">{p.totalItems !== undefined ? `${p.completedItems.toLocaleString()} of ${p.totalItems.toLocaleString()} items` : 'Checking both folders again…'}{p.totalBytes ? ` · ${formatBytes(p.completedBytes)} of ${formatBytes(p.totalBytes)}` : ''}</span>
        </>
      )}
      {done && s && (
        <p className="tabular small">{s.done} done{s.skipped ? ` · ${s.skipped} skipped` : ''}{s.failed ? ` · ${s.failed} failed` : ''}{s.cancelled ? ` · ${s.cancelled} not started` : ''}</p>
      )}
      {op.error && <p className="error-text small">{op.error.message}</p>}
      {op.notes?.map((n) => <p key={n} className="muted small">{n}</p>)}
      {done && failures.length > 0 && (
        <ul className="op-failures small">
          {failures.slice(0, 50).map((f) => <li key={f.source}><span className="mono">{f.source}</span> — {f.error?.message}</li>)}
          {failures.length > 50 && <li className="muted">…and {failures.length - 50} more (see Operations)</li>}
        </ul>
      )}
    </section>
  );
}

function PlanView({ plan, outdated, decisions, setDecisions, actionable, blockedByTrash, onSynchronize, onPreviewAgain, approval }: {
  approval?: { approve: boolean; setApprove: (v: boolean) => void; onApproveOnly: () => void };
  plan: SyncPlan;
  outdated: boolean;
  decisions: Record<number, ConflictChoice>;
  setDecisions: (d: Record<number, ConflictChoice>) => void;
  actionable: number;
  blockedByTrash: boolean;
  onSynchronize: () => void;
  onPreviewAgain: () => void;
}) {
  const [filter, setFilter] = useState<'all' | SyncActionKind>(plan.groups.conflict.count ? 'conflict' : 'all');
  const [query, setQuery] = useState('');
  const [allChoice, setAllChoice] = useState<ConflictChoice>('skip');
  const conflicts = plan.actions.filter((a) => a.action === 'conflict');
  const decided = conflicts.filter((a) => (decisions[a.id] ?? 'skip') !== 'skip').length;
  const union = (['left', 'right', 'both', 'skip'] as ConflictChoice[]).filter((c) => conflicts.some((a) => a.choices?.includes(c)));
  const total = plan.actions.length;

  const applyAll = () => {
    const next = { ...decisions };
    let applied = 0;
    for (const a of conflicts) {
      if (a.choices?.includes(allChoice)) {
        next[a.id] = allChoice;
        applied++;
      }
    }
    setDecisions(next);
    toast({ level: 'info', title: `Applied to ${formatCount(applied, 'conflict')}`, detail: applied < conflicts.length ? `${conflicts.length - applied} conflict(s) do not offer this choice and were left as they were.` : undefined });
  };

  const q = query.trim().toLowerCase();
  const visible = plan.actions.filter((a) => (filter === 'all' || a.action === filter) && (!q || a.rel.toLowerCase().includes(q)));

  return (
    <section aria-labelledby="sync-plan-h" className="sync-plan">
      <div className="section-head"><h2 id="sync-plan-h">Preview</h2><span className="muted small">{formatDate(plan.createdMs)}</span></div>
      <div className="stat-strip">
        {GROUPS.map((g) => (
          <div key={g.kind} className="stat">
            <span className="stat-label">{g.title}</span>
            <span className="stat-value tabular">{plan.groups[g.kind].count.toLocaleString()}</span>
            <span className="muted small tabular">{formatBytes(plan.groups[g.kind].bytes)}</span>
          </div>
        ))}
        <div className="stat">
          <span className="stat-label">Already the same</span>
          <span className="stat-value tabular">{plan.inSync.toLocaleString()}</span>
        </div>
        <div className="stat-flags">
          {plan.complete ? <Pill tone="success">Both folders read completely</Pill> : <Pill tone="warning">{formatCount(plan.unreadable.length, 'location')} unreadable</Pill>}
          {plan.baseline && <Pill tone="neutral">Compared with the run of {formatDate(plan.baseline.updatedMs)}</Pill>}
        </div>
      </div>
      <p className="mono muted small ellipsis" title={`${plan.left} ${plan.mode === 'two-way' ? '⇄' : '→'} ${plan.right}`}>{plan.left} {plan.mode === 'two-way' ? '⇄' : '→'} {plan.right}</p>
      {outdated && (
        <div className="callout warning" role="status"><Icon name="warning" size={16} /><span>The folders, mode or options changed after this preview. Preview again before synchronizing.</span></div>
      )}
      {plan.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
      {(plan.excluded > 0 || plan.extraKept > 0 || plan.notCompared > 0 || plan.specialSkipped > 0) && (
        <p className="muted small">
          {[
            plan.excluded ? `${formatCount(plan.excluded, 'item')} left alone by the patterns or “Skip hidden items”` : '',
            plan.extraKept ? `${formatCount(plan.extraKept, 'item')} only in the target, kept` : '',
            plan.notCompared ? `${formatCount(plan.notCompared, 'item')} inside conflicting or unreadable items, not compared` : '',
            plan.specialSkipped ? `${formatCount(plan.specialSkipped, 'special file')} (devices, sockets, pipes) never synchronized` : '',
          ].filter(Boolean).join(' · ')}.
        </p>
      )}
      {plan.unreadable.length > 0 && (
        <details className="small"><summary>Locations that could not be read</summary><ul className="op-failures">{plan.unreadable.map((u) => <li key={u} className="mono">{u}</li>)}</ul></details>
      )}
      {plan.truncated && <p className="warning-text small">The plan has {total.toLocaleString()}+ rows; only the first {plan.actions.length.toLocaleString()} are listed. Every action is still carried out.</p>}

      {!total ? <EmptyState icon="check" title="Nothing to do" body="Both folders already match for the chosen mode and options." /> : (
        <>
          {conflicts.length > 0 && (
            <div className="selection-bar sync-apply-all">
              <span>{decided} of {formatCount(conflicts.length, 'conflict')} decided; the rest are skipped.</span>
              <span className="spacer" />
              <label className="sr-only" htmlFor="sync-apply-choice">Decision for all conflicts</label>
              <select id="sync-apply-choice" className="input sync-choice" value={allChoice} onChange={(e) => setAllChoice(e.target.value as ConflictChoice)}>
                {union.map((c) => <option key={c} value={c}>{c === 'left' ? (plan.mode === 'two-way' ? 'Keep left' : 'Use the source version') : c === 'right' ? 'Keep right' : c === 'both' ? 'Keep both' : 'Skip'}</option>)}
              </select>
              <Button size="sm" onClick={applyAll}>Apply to all conflicts</Button>
            </div>
          )}
          <div className="sync-filter">
            <Segmented<'all' | SyncActionKind>
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[{ value: 'all' as const, label: `All (${total.toLocaleString()})` }, ...GROUPS.filter((g) => plan.groups[g.kind].count).map((g) => ({ value: g.kind, label: `${g.title} (${plan.groups[g.kind].count.toLocaleString()})` }))]}
            />
            <TextField id="sync-filter-text" label="Filter by path" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Part of a name or folder" />
          </div>
          <PlanTable plan={plan} rows={visible} decisions={decisions} onDecide={(id, c) => setDecisions({ ...decisions, [id]: c })} />
        </>
      )}
      {approval && (
        <div className="callout sync-approval" role="status">
          <Icon name="schedule" size={16} />
          <div className="grow">
            <strong>This pair runs on a schedule and needs your approval.</strong>
            <p className="small">Approving lets scheduled runs use exactly these folders, mode and options. Each scheduled run previews first and stops without changing anything when there are conflicts or more deletions than the pair’s limit.</p>
            {actionable > 0
              ? <label className="check"><input type="checkbox" checked={approval.approve} onChange={(e) => approval.setApprove(e.target.checked)} /> Approve for scheduled runs when I synchronize now</label>
              : <Button size="sm" icon="check" onClick={approval.onApproveOnly}>Approve for scheduled runs</Button>}
          </div>
        </div>
      )}
      <div className="selection-bar sync-run-bar">
        <span>{blockedByTrash ? 'The Trash is not available here, so items cannot be deleted or replaced.' : actionable ? `${formatCount(actionable, 'change')} ready` : 'Nothing will be changed.'}</span>
        <span className="spacer" />
        <Button onClick={onPreviewAgain}>Preview again</Button>
        <Button variant="primary" icon="sync" disabled={outdated || !actionable || blockedByTrash} onClick={onSynchronize}>Synchronize</Button>
      </div>
    </section>
  );
}

/** The plan grouped by action. Rows use a roving tab stop: arrow keys, Home/End and Page Up/Down move between rows. */
function PlanTable({ plan, rows, decisions, onDecide }: { plan: SyncPlan; rows: SyncAction[]; decisions: Record<number, ConflictChoice>; onDecide: (id: number, c: ConflictChoice) => void }) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [active, setActive] = useState(0);
  const body = useRef<HTMLTableElement>(null);
  const groups = GROUPS.map((g) => {
    const all = rows.filter((r) => r.action === g.kind);
    return { ...g, all, shown: all.slice(0, limits[g.kind] ?? ROWS_STEP) };
  }).filter((g) => g.all.length);
  const flat = groups.flatMap((g) => g.shown);
  const focusRow = (i: number) => {
    const n = Math.max(0, Math.min(flat.length - 1, i));
    setActive(n);
    body.current?.querySelector<HTMLElement>(`tr[data-row="${n}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'TR') return;
    const i = Number(target.dataset.row);
    const page = 10;
    const map: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: flat.length - 1, PageDown: i + page, PageUp: i - page };
    if (e.key in map) {
      e.preventDefault();
      focusRow(map[e.key]!);
    } else if ((e.key === 'Enter' || e.key === ' ') && target.querySelector('select')) {
      e.preventDefault();
      target.querySelector('select')!.focus();
    }
  };
  let index = -1;
  const oneWay = plan.mode !== 'two-way';
  const dir = (a: SyncAction) => {
    if (a.action === 'conflict') return { icon: 'swap', text: 'Both sides', cls: 'is-conflict' };
    if (a.action === 'delete') return { icon: 'trash', text: `Trash (${a.to === 'left' ? 'left' : oneWay ? 'target' : 'right'})`, cls: 'is-delete' };
    return a.to === 'right' ? { icon: 'forward', text: oneWay ? 'To target' : 'Left → right', cls: '' } : { icon: 'back', text: 'Right → left', cls: '' };
  };
  return (
    <div className="sync-table-wrap">
      <table ref={body} className="table sync-table" aria-label="Synchronization preview" onKeyDown={onKey}>
        <thead>
          <tr><th scope="col">Item</th><th scope="col" className="sync-col-dir"><span className="sync-dir-text">Direction</span></th><th scope="col" className="num sync-col-size">Size</th><th scope="col" className="sync-col-decision">Decision</th></tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.kind}>
            <tr className="sync-group-row">
              <th scope="rowgroup" colSpan={4}>{g.title} · {g.all.length.toLocaleString()} · {formatBytes(plan.groups[g.kind].bytes)}</th>
            </tr>
            {g.shown.map((a) => {
              index++;
              const d = dir(a);
              const i = index;
              return (
                <tr key={a.id} data-row={i} tabIndex={i === Math.min(active, flat.length - 1) ? 0 : -1} className="sync-row" onFocus={() => setActive(i)}>
                  <td className="sync-path">
                    <span className="mono">{a.rel}{a.kind === 'directory' ? '/' : ''}</span>
                    {a.kind === 'symlink' && <span className="muted small"> (link)</span>}
                    <div className="sync-reason">{a.reason}{a.items ? ` · ${formatCount(a.items, 'item')} inside` : ''}</div>
                    {(a.action === 'conflict' || a.action === 'update') && (
                      <div className="sync-sides tabular">{oneWay ? 'Source' : 'Left'}: {sideText(a.left)} · {oneWay ? 'Target' : 'Right'}: {sideText(a.right)}</div>
                    )}
                  </td>
                  <td><span className={`sync-dir ${d.cls}`}><Icon name={d.icon} size={14} /><span className="sync-dir-text">{d.text}</span></span></td>
                  <td className="num tabular sync-col-size">{a.kind === 'file' || a.items ? formatBytes(a.bytes) : ''}</td>
                  <td>
                    {a.action === 'conflict' && a.choices && (
                      a.choices.length === 1 ? <span className="muted small">Resolve by hand (skipped)</span> : (
                        <select className="input sync-choice" aria-label={`Decision for ${a.rel}`} value={decisions[a.id] ?? 'skip'} onChange={(e) => onDecide(a.id, e.target.value as ConflictChoice)}>
                          {a.choices.map((c) => <option key={c} value={c}>{choiceLabel(a, c, plan.mode)}</option>)}
                        </select>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {g.all.length > g.shown.length && (
              <tr className="sync-more-row">
                <td colSpan={4}>
                  <Button size="sm" variant="ghost" onClick={() => setLimits({ ...limits, [g.kind]: (limits[g.kind] ?? ROWS_STEP) + ROWS_STEP * 5 })}>
                    Show {Math.min(ROWS_STEP * 5, g.all.length - g.shown.length).toLocaleString()} more of {(g.all.length - g.shown.length).toLocaleString()}
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PairScheduleLine({ s, paused }: { s: PairSchedule; paused: boolean }) {
  const r = s.lastResult;
  return (
    <span className="small sync-schedule-line">
      <Pill tone={s.needsApproval ? 'warning' : 'accent'} title={s.needsApproval ? 'Preview the pair and approve it before it runs on schedule.' : 'Approved for scheduled runs'}>{describeSchedule(s.schedule, formatTimeOfDay)}{s.needsApproval ? ' · needs approval' : ''}</Pill>
      <span className="muted">{s.running ? 'Running now' : paused ? 'Schedules paused' : s.needsApproval ? 'Waiting for your approval' : s.nextRunMs ? `Next run ${formatDate(s.nextRunMs)}` : s.schedule.kind === 'startup' ? 'Runs when Orbis Files starts' : ''}</span>
      {r && <span className={`muted sync-schedule-result is-${r.outcome}`} title={r.message}>Last scheduled run {formatDate(r.ms)}: {r.message}</span>}
    </span>
  );
}

function PairScheduleDialog({ pair, current, onClose, onSaved }: { pair: SyncPair; current?: PairSchedule; onClose: () => void; onSaved: () => void }) {
  const [schedule, setSchedule] = useState<Schedule>(current?.schedule ?? { kind: 'daily', time: '18:00', catchUp: true });
  const [maxDeletes, setMaxDeletes] = useState(current?.maxDeletes ?? 10);
  const ok = ScheduleSchema.safeParse(schedule).success;
  const save = async () => {
    await call('sync:setSchedule', { pairId: pair.id, schedule, maxDeletes }).then(() => {
      toast({ level: 'success', title: schedule.kind === 'manual' ? `“${pair.name}” no longer runs on a schedule` : `Scheduled “${pair.name}”: ${describeSchedule(ScheduleSchema.parse(schedule), formatTimeOfDay)}`, detail: schedule.kind === 'manual' ? undefined : current && !current.needsApproval ? 'It runs with the settings you approved.' : 'Preview the pair and approve it; until then scheduled runs do nothing.' });
      onSaved();
    }, toastError);
  };
  return (
    <Dialog title={`Run “${pair.name}” on a schedule`} onClose={onClose} width={560} className="sync-schedule-dialog" footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={() => void save()}>Save schedule</Button>
      </>
    }>
      <ScheduleFields idPrefix="sync-schedule" value={schedule} onChange={setSchedule} manualLabel="Not on a schedule" />
      {schedule.kind !== 'manual' && (
        <>
          <TextField id="sync-max-deletes" label="Stop when a run would move more than this many items to the Trash" type="number" min={0} max={1000000} value={String(maxDeletes)} onChange={(e) => setMaxDeletes(Math.max(0, Math.round(Number(e.target.value) || 0)))} hint={pair.mode === 'update' ? 'Update never deletes anything.' : 'A folder counts with everything inside it. 0: never delete on a schedule.'} />
          <ul className="small muted sync-schedule-rules">
            <li>The first scheduled run needs your approval: preview the pair and approve it. Changing the folders, mode or options needs a new approval.</li>
            <li>Every scheduled run previews first and stops without changing anything when there are conflicts, unreadable locations or more deletions than the limit. You get a notification.</li>
            <li>Schedules run only while Orbis Files is open.</li>
          </ul>
        </>
      )}
    </Dialog>
  );
}
