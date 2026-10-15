import { createStore } from './store';
import { app } from './app';
import { call } from '../api';
import type { TransferItem, TransferQueueState } from '../../shared/transferQueue';
import type { OperationRecord } from '../../shared/operations';
import { TERMINAL_STATES } from '../../shared/operations';

/**
 * Transfer Queue state: a filtered, enriched view of the operations system
 * focused on copy/move operations. Items are mapped from the ops store.
 */

export const transferQueue = createStore<TransferQueueState>({
  items: [],
  activeCount: 0,
  totalBytes: 0,
  doneBytes: 0,
  speed: 0,
});

/** Speed tracking: rolling window of byte deltas. */
let prevDoneBytes = 0;
let prevTimestamp = 0;
let smoothedSpeed = 0;

function opToTransferItem(op: OperationRecord): TransferItem | null {
  if (op.type !== 'copy' && op.type !== 'move') return null;
  const statusMap: Record<string, TransferItem['status']> = {
    queued: 'queued',
    preparing: 'active',
    running: 'active',
    paused: 'paused',
    awaiting_conflict: 'active',
    cancelling: 'active',
    completed: 'done',
    completed_with_errors: 'error',
    failed: 'error',
    cancelled: 'done',
    interrupted: 'error',
  };
  const status = statusMap[op.state] ?? 'queued';
  return {
    id: op.id,
    type: op.type,
    source: op.sources[0] ?? '',
    dest: op.destination ?? '',
    size: op.progress?.totalBytes,
    progress: op.progress?.completedBytes ?? 0,
    status,
    priority: 0,
    error: op.error?.message,
    itemCount: op.progress?.totalItems,
    completedItems: op.progress?.completedItems,
    startedMs: op.startedMs,
    finishedMs: TERMINAL_STATES.has(op.state) ? Date.now() : undefined,
  };
}

function rebuild(): void {
  const ops = app.get().ops;
  const items: TransferItem[] = [];
  let totalBytes = 0;
  let doneBytes = 0;
  let activeCount = 0;

  for (const op of Object.values(ops)) {
    const item = opToTransferItem(op);
    if (!item) continue;
    items.push(item);
    if (item.size) totalBytes += item.size;
    doneBytes += item.progress;
    if (item.status === 'active') activeCount++;
  }

  // Speed calculation
  const now = Date.now();
  if (prevTimestamp > 0 && now > prevTimestamp) {
    const delta = doneBytes - prevDoneBytes;
    const dt = (now - prevTimestamp) / 1000;
    const instantSpeed = dt > 0 ? Math.max(0, delta / dt) : 0;
    smoothedSpeed = smoothedSpeed === 0 ? instantSpeed : smoothedSpeed * 0.7 + instantSpeed * 0.3;
  }
  if (activeCount === 0) smoothedSpeed = 0;
  prevDoneBytes = doneBytes;
  prevTimestamp = now;

  // Sort by priority then by status (active first, then queued, then done/error)
  const statusOrder: Record<string, number> = { active: 0, queued: 1, paused: 2, error: 3, done: 4 };
  items.sort((a, b) => (a.priority - b.priority) || ((statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5)));

  transferQueue.set({ items, activeCount, totalBytes, doneBytes, speed: smoothedSpeed });
}

let wired = false;
export function wireTransferQueue(): void {
  if (wired) return;
  wired = true;
  app.subscribe(rebuild);
  rebuild();
}

// ── Actions ──

export function addTransfer(type: 'copy' | 'move', sources: string[], destination: string): void {
  wireTransferQueue();
  void call('ops:start', { type, sources, destination, origin: 'transfers' });
}

export function pauseTransfer(id: string): void {
  void call('ops:pause', { id });
}

export function resumeTransfer(id: string): void {
  void call('ops:resume', { id });
}

export function cancelTransfer(id: string): void {
  void call('ops:cancel', { id });
}

export function reorderTransfer(id: string, to: 'first' | 'last'): void {
  void call('ops:prioritize', { id, to });
}

export function clearCompleted(): void {
  const ops = app.get().ops;
  for (const op of Object.values(ops)) {
    if ((op.type === 'copy' || op.type === 'move') && TERMINAL_STATES.has(op.state)) {
      void call('ops:dismiss', { id: op.id });
    }
  }
}

export function pauseAll(): void {
  const ops = app.get().ops;
  for (const op of Object.values(ops)) {
    if ((op.type === 'copy' || op.type === 'move') && (op.state === 'running' || op.state === 'preparing')) {
      void call('ops:pause', { id: op.id });
    }
  }
}

export function resumeAll(): void {
  const ops = app.get().ops;
  for (const op of Object.values(ops)) {
    if ((op.type === 'copy' || op.type === 'move') && op.state === 'paused') {
      void call('ops:resume', { id: op.id });
    }
  }
}
