import React, { useMemo, useState } from 'react';
import { call } from '../api';
import { app, openDialog, toastError } from '../state/app';
import { useStore } from '../state/store';
import { Button, Dialog, EmptyState, IconButton, Pill, ProgressBar, useMenu, type MenuItem } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes, formatDate, formatDuration } from '../ui/format';
import { canUndo, undoLabel, undoOperation } from '../actions';
import { jobs } from '../state/jobs';
import type { ConflictInfo, OperationRecord } from '../../shared/operations';
import { displayPath } from '../state/remote';
import { openDestination, parentOf, transferDirection } from '../actions';
import { POWER_OPERATION_LABELS } from '../../shared/powerTools';
import { formatEta, VIDEO_TOOL_LABEL, type VideoToolId } from '../../shared/videoTools';

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted']);
const STATE_LABEL: Record<string, [string, 'neutral' | 'accent' | 'success' | 'warning' | 'error']> = {
  queued: ['Waiting', 'neutral'], preparing: ['Preparing', 'accent'], running: ['Running', 'accent'], paused: ['Paused', 'warning'],
  awaiting_conflict: ['Needs your decision', 'warning'], cancelling: ['Cancelling', 'warning'], completed: ['Done', 'success'],
  completed_with_errors: ['Finished with errors', 'warning'], failed: ['Failed', 'error'], cancelled: ['Cancelled', 'neutral'], interrupted: ['Interrupted', 'error'],
};
const TYPE_LABEL: Record<string, string> = { copy: 'Copy', move: 'Move', trash: 'Move to Trash', delete: 'Permanent delete', duplicate: 'Duplicate', 'rename-batch': 'Rename', extract: 'Extract', compress: 'Compress', 'edit-metadata': 'Edit metadata', convert: 'Convert', 'trash-restore': 'Restore from Trash', 'trash-delete': 'Delete from Trash', sync: 'Synchronize', dedupe: 'Duplicate clean-up', 'checksum-create': 'Create checksum file', 'pdf-tools': 'PDF tools', 'find-replace': 'Find and replace', 'text-fix': 'Text fixes', 'snapshot-restore': 'Restore from snapshots', 'custom-action': 'Action', encrypt: 'Encrypt', decrypt: 'Decrypt', 'share-receive': 'Receive files (network share)', 'image-batch': 'Image tools', backup: 'Backup', 'backup-restore': 'Restore from backup', 'organize-date': 'Organize by date', 'remote-transfer': 'Transfer', 'remote-delete': 'Permanent delete on a server', 'remote-save': 'Upload changes', 'video-tool': 'Video tool', 'ocr-extract': 'Extract text (OCR)', 'ocr-save': 'Save recognized text' };
Object.assign(TYPE_LABEL, POWER_OPERATION_LABELS);

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** "Copy · report.pdf", "Move to Trash · 3 items"; a synchronization names both folders ("Synchronize · Photos with Backup"). */
export function operationTitle(op: Pick<OperationRecord, 'type' | 'sources' | 'destination'> & { output?: OperationRecord['output']; origin?: string }): string {
  const dir = op.type === 'remote-transfer' ? transferDirection(op) : undefined;
  // Video tools name the tool in their origin ("video-tools:trim").
  const tool = op.type === 'video-tool' && op.origin?.startsWith('video-tools:') ? VIDEO_TOOL_LABEL[op.origin.slice(12) as VideoToolId] : undefined;
  const label = dir ? (dir.kind === 'upload' ? `Upload to ${dir.server}` : dir.kind === 'download' ? `Download from ${dir.server}` : `Transfer on ${dir.server}`) : (tool ?? TYPE_LABEL[op.type] ?? op.type);
  if (op.type === 'custom-action' && op.output) return `${op.output.action} · ${op.sources.length === 1 ? baseName(op.sources[0]!) : `${op.sources.length} items`}`;
  if (op.type === 'sync' && op.sources.length === 1 && op.destination) return `${label} · ${baseName(op.sources[0]!)} with ${baseName(op.destination)}`;
  return `${label} · ${op.sources.length === 1 ? baseName(op.sources[0]!) : `${op.sources.length} items`}`;
}

const ORIGIN_LABEL: Record<string, string> = {
  ui: 'a command or shortcut', paste: 'Paste', drag: 'drag and drop', 'other-pane': 'the other pane', properties: 'the details panel', 'quick-zip': 'Compress to .zip',
  'trash-view': 'Trash', 'trash-empty': 'Empty Trash', duplicates: 'Find duplicates', 'similar-images': 'Similar images', 'storage-cleanup': 'Storage analysis',
  'checksum-file': 'Create checksum file', 'bulk-rename': 'Bulk rename', 'archive-view': 'the archive view', compare: 'Compare folders', convert: 'Convert',
  import: 'Import into the Orbis Library', sync: 'Synchronize folders', shelf: 'the shelf', action: 'a custom action', encrypt: 'Encrypt…', decrypt: 'Decrypt…', 'image-tools': 'Batch image tools',
  'video-tools': 'Video tools',
};

/** Where an operation was started, in words (origins are internal ids, some with a record id after a colon). */
export function originLabel(origin: string): string {
  const [kind, ref] = origin.split(':', 2) as [string, string | undefined];
  if (kind === 'sync' && ref) return 'Synchronize folders (a saved pair)';
  if (kind === 'sync-schedule') return 'a scheduled synchronization';
  if (kind === 'backup') return 'Backups (Run now)';
  if (kind === 'backup-schedule') return 'a scheduled backup';
  if (kind === 'backup-restore') return 'Backups (restore)';
  if (kind === 'rule') return 'an organising rule';
  if (kind === 'share') return 'a device on the local network (network share)';
  if (kind === 'rule-auto') return 'an organising rule, automatically';
  if (kind === 'rule-undo') return 'undoing a rule run';
  if (kind === 'retry') return 'Retry unfinished items';
  return ORIGIN_LABEL[kind] ?? kind.replace(/[-_]/g, ' ');
}

export function OperationsPanel() {
  const open = useStore(app, (s) => s.opsPanelOpen);
  const busyInBackground = useStore(jobs, (s) => s.list.length > 0 || s.index?.state === 'scanning');
  if (!open) return null;
  return (
    <aside className="ops-panel" aria-label="Operations">
      <div className="ops-panel-head">
        <h2>Operations</h2>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => {
          for (const o of Object.values(app.get().ops)) if (TERMINAL.has(o.state)) void call('ops:dismiss', { id: o.id }).catch(() => undefined);
        }}>Clear finished</Button>
        <IconButton icon="close" label="Close operations" onClick={() => app.set({ opsPanelOpen: false })} />
      </div>
      <BackgroundTasks />
      <OperationsList brief={busyInBackground} />
    </aside>
  );
}

/** Read-only analysis tasks and indexing, shown next to file operations with the same controls. */
function BackgroundTasks() {
  const st = useStore(jobs, (s) => s);
  const indexing = st.index?.state === 'scanning';
  if (!st.list.length && !indexing) return null;
  return (
    <section className="bg-tasks" aria-label="Background tasks">
      <h3 className="bg-tasks-head">Background tasks <span className="muted small">read-only; your files are not changed</span></h3>
      {indexing && (
        <div className="op">
          <div className="op-head"><Icon name="search" size={14} /><span className="op-title">Updating the search index{st.index?.currentRoot ? ` · ${st.index.currentRoot.split(/[\\/]/).filter(Boolean).pop()}` : ''}</span><Pill tone="accent">Running</Pill></div>
          <ProgressBar label="Indexing" />
          <div className="muted small tabular">{st.index!.scanned.toLocaleString()} checked</div>
        </div>
      )}
      {st.list.map((j) => {
        const c = st.controls[j.id];
        return (
          <div key={j.id} className="op">
            <div className="op-head">
              <Icon name="activity" size={14} />
              <span className="op-title">{j.label}</span>
              <Pill tone={c?.paused ? 'warning' : 'accent'}>{c?.paused ? 'Paused' : 'Running'}</Pill>
              <div className="op-actions">
                {c?.pausable && !c.paused && <IconButton icon="pause" label="Pause" onClick={c.pause} />}
                {c?.pausable && c.paused && <IconButton icon="play" label="Resume" onClick={c.resume} />}
                <IconButton icon="stop" label="Cancel" onClick={j.cancel} />
              </div>
            </div>
            <ProgressBar label={j.label} value={j.fraction} tone={c?.paused ? 'warning' : 'accent'} />
            <div className="muted small tabular">{c?.paused ? 'Paused · ' : ''}{j.progress ?? 'Working…'} · {formatDuration(Date.now() - j.startedMs)}</div>
          </div>
        );
      })}
    </section>
  );
}

/** File operations, newest first. `brief`: say "none" in one line (background tasks are listed above it). */
export function OperationsList({ brief }: { brief?: boolean }) {
  const ops = useStore(app, (s) => s.ops);
  const list = useMemo(() => Object.values(ops).sort((a, b) => b.createdMs - a.createdMs), [ops]);
  if (!list.length && brief) return <p className="ops-none muted small">No file operations. Copies, moves and other changes to files appear here.</p>;
  if (!list.length) return <EmptyState icon="activity" title="No operations" body="Copies, moves, deletions, extractions and renames appear here with their real progress and results." />;
  return (
    <div className="ops-list">
      {list.map((o) => <OperationRow key={o.id} op={o} />)}
    </div>
  );
}

function OperationRow({ op }: { op: OperationRecord }) {
  const [expanded, setExpanded] = useState(op.state === 'interrupted' || op.state === 'failed');
  const [label, tone] = STATE_LABEL[op.state] ?? [op.state, 'neutral'];
  const p = op.progress;
  // Only show a percentage when it can be measured.
  const frac = p.fraction !== undefined ? p.fraction : p.totalBytes ? p.completedBytes / p.totalBytes : p.totalItems ? p.completedItems / p.totalItems : undefined;
  const elapsed = op.startedMs ? (op.finishedMs ?? Date.now()) - op.startedMs : 0;
  const rate = elapsed > 1500 && p.completedBytes > 0 ? p.completedBytes / (elapsed / 1000) : undefined;
  const failures = op.results.filter((r) => r.status === 'failed');
  const act = (fn: () => Promise<unknown>) => void fn().catch(toastError);
  const title = operationTitle(op);

  const menu = useMenu();
  const contextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (op.state === 'queued') items.push({ label: 'Run next', icon: 'prioritize', run: () => act(() => call('ops:prioritize', { id: op.id, to: 'first' })) }, { label: 'Run last', icon: 'chevronDown', run: () => act(() => call('ops:prioritize', { id: op.id, to: 'last' })) });
    if (op.state === 'running' && op.pausable) items.push({ label: 'Pause', icon: 'pause', run: () => act(() => call('ops:pause', { id: op.id })) });
    if (op.state === 'paused') items.push({ label: 'Resume', icon: 'play', run: () => act(() => call('ops:resume', { id: op.id })) });
    if (!TERMINAL.has(op.state) && op.state !== 'cancelling') items.push({ label: 'Cancel', icon: 'stop', danger: true, run: () => act(() => call('ops:cancel', { id: op.id })) });
    if (op.output) items.push({ label: 'Show output', icon: 'fileText', run: () => openDialog('actionOutput', { opId: op.id }) });
    if (op.type !== 'custom-action' && ['failed', 'completed_with_errors', 'interrupted', 'cancelled'].includes(op.state) && op.results.some((r) => r.status !== 'done')) items.push({ label: 'Retry unfinished items', icon: 'retry', run: () => act(() => call('ops:retry', { id: op.id })) });
    if (canUndo(op)) items.push({ label: undoLabel(op), icon: 'undo', run: () => void undoOperation(op.id) });
    if (op.destination && op.type !== 'remote-save') items.push({ label: 'Open destination', icon: 'folderOpen', run: () => openDestination(op.destination!) });
    items.push({ label: 'Copy details', icon: 'copy', run: () => void call('fs:copyText', { text: [title, `State: ${op.state}`, ...op.results.map((r) => `${r.status}: ${r.source}${r.destination ? ` → ${r.destination}` : ''}${r.error ? ` (${r.error.message})` : ''}`)].join('\n') }) });
    if (TERMINAL.has(op.state)) items.push({ label: 'Dismiss', icon: 'close', run: () => act(() => call('ops:dismiss', { id: op.id })) });
    menu.open(items, e.clientX, e.clientY);
  };
  return (
    <div className={`op ${TERMINAL.has(op.state) ? 'done' : ''}`} onContextMenu={contextMenu}>
      {menu.node}
      <div className="op-head">
        <button type="button" className="op-title" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
          <span className="ellipsis">{title}</span>
        </button>
        {op.origin.startsWith('rule-auto:') && <Pill tone="accent" title="Started by an organising rule that runs automatically on new files">Automatic</Pill>}
        {(op.origin.startsWith('backup-schedule:') || op.origin.startsWith('sync-schedule:')) && <Pill tone="accent" title="Started by a schedule">Scheduled</Pill>}
        <Pill tone={tone}>{label}</Pill>
        <div className="op-actions">
          {op.state === 'queued' && <IconButton icon="prioritize" label="Run next (move to the front of the queue)" onClick={() => act(() => call('ops:prioritize', { id: op.id, to: 'first' }))} />}
          {op.state === 'queued' && <IconButton icon="chevronDown" label="Run last (move to the back of the queue)" onClick={() => act(() => call('ops:prioritize', { id: op.id, to: 'last' }))} />}
          {op.state === 'running' && op.pausable && <IconButton icon="pause" label="Pause" onClick={() => act(() => call('ops:pause', { id: op.id }))} />}
          {op.state === 'paused' && <IconButton icon="play" label="Resume" onClick={() => act(() => call('ops:resume', { id: op.id }))} />}
          {!TERMINAL.has(op.state) && op.state !== 'cancelling' && <IconButton icon="stop" label="Cancel" onClick={() => act(() => call('ops:cancel', { id: op.id }))} />}
          {op.output && op.output.runs.length > 0 && <IconButton icon="fileText" label="Show output" onClick={() => openDialog('actionOutput', { opId: op.id })} />}
          {op.type !== 'custom-action' && ['failed', 'completed_with_errors', 'interrupted', 'cancelled'].includes(op.state) && op.results.some((r) => r.status !== 'done') && <IconButton icon="retry" label="Retry unfinished items" onClick={() => act(() => call('ops:retry', { id: op.id }))} />}
          {canUndo(op) && <IconButton icon="undo" label={undoLabel(op)} onClick={() => void undoOperation(op.id)} />}
          {op.destination && op.type !== 'remote-save' && <IconButton icon="folderOpen" label="Open destination" onClick={() => openDestination(op.destination!)} />}
          {TERMINAL.has(op.state) && <IconButton icon="close" label="Dismiss (keeps the results)" onClick={() => act(() => call('ops:dismiss', { id: op.id }))} />}
        </div>
      </div>
      {!TERMINAL.has(op.state) && (
        <>
          <ProgressBar label={`${title} progress`} value={op.state === 'preparing' || op.state === 'queued' ? undefined : frac} tone={op.state === 'paused' || op.state === 'awaiting_conflict' ? 'warning' : 'accent'} />
          <div className="op-meta tabular">
            {p.totalItems !== undefined && <span>{p.completedItems.toLocaleString()} / {p.totalItems.toLocaleString()} items</span>}
            {p.totalBytes !== undefined && p.totalBytes > 0 && <span>{formatBytes(p.completedBytes)} / {formatBytes(p.totalBytes)}</span>}
            {rate && <span>{formatBytes(rate)}/s</span>}
            {op.state === 'running' && p.etaSec !== undefined && <span>{formatEta(p.etaSec)}</span>}
            {!TERMINAL.has(op.state) && !op.pausable && op.pauseUnavailable && <span className="muted" title={op.pauseUnavailable}>Cannot be paused here</span>}
            {p.currentItem && <span className="ellipsis">{p.currentItem}</span>}
          </div>
        </>
      )}
      {TERMINAL.has(op.state) && op.summary && (
        <div className="op-meta tabular">
          <span>{op.summary.done} done</span>
          {op.summary.skipped > 0 && <span>{op.summary.skipped} skipped</span>}
          {op.summary.failed > 0 && <span className="error-text">{op.summary.failed} failed</span>}
          {op.summary.cancelled > 0 && <span>{op.summary.cancelled} not started</span>}
          {op.startedMs && <span>{formatDuration(elapsed)}</span>}
          <span className="muted">{formatDate(op.finishedMs)}</span>
        </div>
      )}
      {expanded && (
        <div className="op-details">
          {op.destination && <div><span className="muted">To </span><span className="mono">{displayPath(op.destination)}</span></div>}
          {op.notes?.map((n) => <p key={n} className="small">{n}</p>)}
          {op.output?.runs.map((r, i) => <div key={i} className="small mono ellipsis" title={r.command}>{r.label}: {r.error ? r.error : r.timedOut ? 'stopped at the time limit' : r.cancelled ? 'stopped' : `exit code ${r.exitCode ?? '—'}`}</div>)}
          {TERMINAL.has(op.state) && op.undo?.kind === 'none' && <p className="muted small">Not undone automatically: {op.undo.reason}</p>}
          <div className="muted small">Started from {originLabel(op.origin)}</div>
          {op.error && <p className="error-text">{op.error.message}{op.error.errorId ? ` (${op.error.errorId})` : ''}</p>}
          {op.error?.dataChanged && op.state !== 'completed' && <p className="muted small">Changes on disk: {{ no: 'none', yes: 'yes', partial: 'some items were completed', unknown: 'unknown — check the destination' }[op.error.dataChanged]}</p>}
          {failures.length > 0 && (
            <ul className="op-failures">
              {failures.slice(0, 200).map((f) => (
                <li key={f.source}><span className="mono">{displayPath(f.source)}</span> — {f.error?.message}</li>
              ))}
              {failures.length > 200 && <li className="muted">…and {failures.length - 200} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Conflict prompt for whichever operation is waiting. Explains the consequence of each choice. */
export function ConflictDialog() {
  const conflict = useStore(app, (s) => s.conflicts[0]);
  const [all, setAll] = useState(false);
  if (!conflict) return null;
  return <ConflictBody key={`${conflict.operationId}|${conflict.source}`} c={conflict} all={all} setAll={setAll} />;
}

function ConflictBody({ c, all, setAll }: { c: ConflictInfo; all: boolean; setAll: (v: boolean) => void }) {
  const decide = (action: 'skip' | 'replace' | 'keep-both' | 'merge' | 'cancel') => {
    app.set((s) => ({ conflicts: s.conflicts.filter((x) => !(x.operationId === c.operationId && x.source === c.source)) }));
    void call('ops:resolveConflict', { id: c.operationId, decision: { action, applyToAll: all } }).catch(toastError);
  };
  const bothDirs = c.sourceKind === 'directory' && c.destinationKind === 'directory';
  const fromBackup = useStore(app, (s) => s.ops[c.operationId]?.type === 'backup-restore');
  // Flatten folder replaces through the Trash, like a backup restore.
  const replaceViaTrash = useStore(app, (s) => s.ops[c.operationId]?.type === 'flatten');
  const allows = (a: 'skip' | 'replace' | 'keep-both' | 'merge') => !c.allowed || c.allowed.includes(a);
  const name = c.destination.split(/[\\/]/).pop();
  return (
    <Dialog title={`“${name}” already exists`} onClose={() => decide('cancel')} width={560} footer={
      <>
        <label className="check grow"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Do this for all remaining conflicts in this operation</label>
        <Button onClick={() => decide('cancel')}>Stop operation</Button>
      </>
    }>
      <p className="muted">In <span className="mono">{displayPath(parentOf(c.destination) ?? c.destination)}</span></p>
      <div className="conflict-compare">
        <div><span className="muted small">{fromBackup ? 'From the backup' : 'Incoming'}</span><strong>{c.sourceKind}</strong><span className="tabular">{c.sourceSize !== undefined ? formatBytes(c.sourceSize) : ''}</span><span className="tabular muted">{formatDate(c.sourceModifiedMs)}</span></div>
        <div><span className="muted small">Already there</span><strong>{c.destinationKind}</strong><span className="tabular">{c.destinationSize !== undefined ? formatBytes(c.destinationSize) : ''}</span><span className="tabular muted">{formatDate(c.destinationModifiedMs)}</span></div>
      </div>
      <div className="choice-list">
        {allows('keep-both') && (
          <button type="button" className="choice" data-autofocus onClick={() => decide('keep-both')}>
            <strong>Keep both</strong><span>The incoming item is saved as “{c.suggestedName}”.</span>
          </button>
        )}
        {bothDirs && allows('merge') && (
          <button type="button" className="choice" onClick={() => decide('merge')}>
            <strong>Merge folders</strong><span>Combine the contents. You’ll be asked about any files that exist in both.</span>
          </button>
        )}
        <button type="button" className="choice" onClick={() => decide('skip')}>
          <strong>Skip</strong><span>{fromBackup ? 'Leave the existing item as it is; this item is not restored.' : c.allowed ? 'Leave the existing item as it is; the incoming item stays where it is now.' : 'Leave the existing item as it is and don’t copy this one.'}</span>
        </button>
        {allows('replace') && (
          <button type="button" className="choice danger" onClick={() => decide('replace')}>
            <strong>Replace</strong>
            <span>{fromBackup ? 'The item already there is moved to the Trash first; then the copy from the backup takes its place.' : replaceViaTrash ? 'The item already there is moved to the Trash first; then this file takes its place.' : c.destinationKind === 'directory' || c.sourceKind === 'directory' ? 'The existing folder is moved to the Trash first, then replaced.' : 'The existing file is overwritten after the new copy is complete. This cannot be undone.'}</span>
          </button>
        )}
        {!allows('replace') && <p className="muted small">The item already there is never replaced by this operation.</p>}
      </div>
    </Dialog>
  );
}
