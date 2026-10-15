/**
 * Transfer Queue types: a UI-level view of copy/move operations with
 * priority, pause/resume and speed tracking.
 */

export interface TransferItem {
  id: string;
  type: 'copy' | 'move';
  source: string;
  dest: string;
  /** Total bytes to transfer (undefined while preparing). */
  size?: number;
  /** Bytes transferred so far. */
  progress: number;
  status: 'queued' | 'active' | 'paused' | 'done' | 'error';
  /** Lower number = higher priority (0 is highest). */
  priority: number;
  error?: string;
  /** Items count (files being transferred). */
  itemCount?: number;
  completedItems?: number;
  startedMs?: number;
  finishedMs?: number;
}

export interface TransferQueueState {
  items: TransferItem[];
  activeCount: number;
  totalBytes: number;
  doneBytes: number;
  /** Bytes per second, smoothed. */
  speed: number;
}
