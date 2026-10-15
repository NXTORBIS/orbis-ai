import type { OrbisErrorShape } from './errors';

/**
 * File-operation model. Every mutation that can take time or touch many items
 * runs through the OperationManager and is represented by an OperationRecord.
 */

export type OperationType = 'copy' | 'move' | 'trash' | 'delete' | 'rename-batch' | 'extract' | 'compress' | 'duplicate' | 'edit-metadata' | 'convert'
  /** Restore items from the system Trash (sources are paths inside the Trash; destination = "Restore to…" folder). */
  | 'trash-restore'
  /** Permanently delete items from the system Trash (also used to empty it). */
  | 'trash-delete'
  /** Synchronize two folders from a previewed plan (sources: [left], destination: right). */
  | 'sync'
  /** Act on copies marked in duplicate groups (params: action trash | move | hardlink, groups with kept and marked copies). */
  | 'dedupe'
  /** Write a SHA-256 checksum file (GNU coreutils format) for the sources into the destination folder. */
  | 'checksum-create'
  /** PDF tools: merge, split, extract or rebuild pages into new PDFs in the destination (params.job, see shared/docTools.ts). */
  | 'pdf-tools'
  /** Replace text in files (params: query, replacement, files with their searched SHA-256 and chosen matches). Snapshots first. */
  | 'find-replace'
  /** Text fixes (encoding to UTF-8, line endings, trailing whitespace, final newline, BOM). Snapshots first. */
  | 'text-fix'
  /** Put back files edited in place from the snapshots taken before the edit (the undo of find-replace and text-fix). */
  | 'snapshot-restore'
  /** Run a custom action (params: actionId, folder); sources are the items it runs on. */
  | 'custom-action'
  /** Encrypt files into <name>.orbisenc next to each (params: password, deleteOriginals). Folders: every file inside. */
  | 'encrypt'
  /** Decrypt .orbisenc files next to each (params: password). Folders: every .orbisenc inside. */
  | 'decrypt'
  /** Commit files a local-network share received (staged in a private folder inside `destination`). Main process only. */
  | 'share-receive'
  /** Batch image tools: resize, crop, rotate, flip, remove metadata, convert (params: spec, optional window-encoded outputs). */
  | 'image-batch'
  /** Make a new version of a backup job (params.jobId; sources: the job's folders, destination: its backup store). */
  | 'backup'
  /** Restore items from a backup version (params: jobId, version, items, target). Conflicts are asked, never overwritten silently. */
  | 'backup-restore'
  /** Organize by date: move or copy files into folders built from a date pattern under `destination` (params.spec, see shared/organize.ts). */
  | 'organize-date'
  /** Copy or move between this computer and a server (SFTP/WebDAV), or within one server (params.mode). Remote items are orbis-remote:// references. */
  | 'remote-transfer'
  /** Permanently delete items on a server (there is no Trash there). */
  | 'remote-delete'
  /** "Upload changes": put an edited local copy of a remote file back, only if the server's file is unchanged (sources: [local copy], destination: its reference). */
  | 'remote-save'
  // Power tools (see shared/powerTools.ts)
  /** Split one file into numbered parts name.ext.001… (params: SplitParams; destination: the folder for the parts). */
  | 'split-file'
  /** Join numbered parts into one file (sources: the parts in order; params: output name, descriptor, keepOnMismatch). */
  | 'join-files'
  /** Secure delete: overwrite, fsync, rename, truncate, unlink (params: passes). Cannot be undone. */
  | 'shred'
  /** Move every file from the subfolders of `sources[0]` into it (params: FlattenSpec). */
  | 'flatten'
  /** The undo of a flatten: recreate removed folders and move the files back (params: the recorded moves and folders). */
  | 'flatten-restore'
  /** Set modification/access times (params.items: path and new times). */
  | 'set-dates'
  /** Create hard links (or Windows junctions) in `destination` (params: LinkParams). */
  | 'link-create'
  /** Save the clipboard's image or text as a new file (started by the main process only; params hold the data). */
  | 'clip-save'
  /** Video tools with the installed FFmpeg (params.spec, see shared/videoTools.ts): trim, extract audio, GIF/WebP, contact sheet, frame, join, rotate. New files only. */
  | 'video-tool'
  /** Text recognition: "Extract text to files" (params: shared/ocr.ts OcrExtractParams; destination: where a combined Markdown file goes). */
  | 'ocr-extract'
  /** Text recognition: save the recognized text shown in the panel as a .txt next to its file (params.text). */
  | 'ocr-save'
  /** Edit an archive in place: add, delete, rename, move entries or create folders (params: sub-action and details). */
  | 'archive-edit';

export type OperationState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'awaiting_conflict'
  | 'cancelling'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export const TERMINAL_STATES: ReadonlySet<OperationState> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'interrupted',
]);

/** Allowed state transitions. Anything else is rejected by the manager. */
export const TRANSITIONS: Record<OperationState, OperationState[]> = {
  queued: ['preparing', 'cancelled'],
  preparing: ['running', 'cancelling', 'failed', 'cancelled', 'awaiting_conflict'],
  running: ['paused', 'awaiting_conflict', 'cancelling', 'completed', 'completed_with_errors', 'failed', 'interrupted'],
  paused: ['running', 'cancelling', 'interrupted'],
  awaiting_conflict: ['running', 'cancelling', 'interrupted'],
  cancelling: ['cancelled', 'completed_with_errors', 'failed', 'interrupted'],
  completed: [],
  completed_with_errors: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

export function canTransition(from: OperationState, to: OperationState): boolean {
  return TRANSITIONS[from].includes(to);
}

export type ConflictPolicy = 'ask' | 'skip' | 'replace' | 'keep-both' | 'merge';

export type ConflictDecision = {
  action: 'skip' | 'replace' | 'keep-both' | 'merge' | 'cancel';
  applyToAll: boolean;
};

export interface ConflictInfo {
  operationId: string;
  source: string;
  destination: string;
  sourceKind: 'file' | 'directory' | 'symlink' | 'other';
  destinationKind: 'file' | 'directory' | 'symlink' | 'other';
  sourceSize?: number;
  destinationSize?: number;
  sourceModifiedMs?: number;
  destinationModifiedMs?: number;
  suggestedName: string;
  remaining: number;
  /** The choices this operation accepts (all when absent). Restoring from the Trash never replaces or merges. */
  allowed?: Array<'skip' | 'replace' | 'keep-both' | 'merge'>;
}

export interface ItemResult {
  source: string;
  destination?: string;
  status: 'done' | 'skipped' | 'failed' | 'cancelled';
  error?: OrbisErrorShape;
}

export interface OperationProgress {
  /** Total items, when known after preparation. */
  totalItems?: number;
  completedItems: number;
  /** Total bytes, when measurable. */
  totalBytes?: number;
  completedBytes: number;
  currentItem?: string;
  /** Measured completion (0–1) for work not counted in items or bytes, e.g. media time converted. */
  fraction?: number;
  /** Estimated seconds left (video tools: from FFmpeg's reported position and the running time so far, paused time excluded). */
  etaSec?: number;
}

export interface OperationRequest {
  type: OperationType;
  sources: string[];
  destination?: string;
  conflictPolicy?: ConflictPolicy;
  /** For rename-batch: explicit list of [from, to] absolute paths. */
  renames?: Array<{ from: string; to: string }>;
  /** Free-form origin label for audit ("toolbar", "shortcut", "drag", "ai:<task>"). */
  origin?: string;
  /** Extra parameters for extract/compress. */
  params?: Record<string, unknown>;
}

/** What a custom action printed, per run (bounded; see shared/customActions ACTION_OUTPUT_LIMIT). */
export interface ActionRunOutput {
  actionId: string;
  action: string;
  showOutput: boolean;
  shell: boolean;
  runs: Array<{
    label: string;
    /** The program and arguments as run (or the shell command line in shell mode). */
    command: string;
    cwd: string;
    exitCode: number | null;
    signal?: string;
    timedOut?: boolean;
    cancelled?: boolean;
    /** The program could not be started (not found, not executable…). */
    error?: string;
    stdout: string;
    stderr: string;
    truncated?: boolean;
    durationMs: number;
  }>;
}

export interface OperationRecord {
  id: string;
  type: OperationType;
  state: OperationState;
  sources: string[];
  destination?: string;
  origin: string;
  createdMs: number;
  startedMs?: number;
  finishedMs?: number;
  progress: OperationProgress;
  results: ItemResult[];
  error?: OrbisErrorShape;
  conflict?: ConflictInfo;
  pausable: boolean;
  /** Why this operation cannot be paused, when it cannot (shown instead of a Pause button). */
  pauseUnavailable?: string;
  /** Whether the result can be reversed (e.g. trash, rename) and how. */
  undo?:
    | { kind: 'rename-batch'; renames: Array<{ from: string; to: string }> }
    /** `cleanupDirs`: folders the operation created; removed (only when empty) after the undo finished. */
    | { kind: 'transfer'; mode: 'move' | 'copy'; items: Array<{ source: string; destination: string }>; cleanupDirs?: string[] }
    /** Items moved to the system Trash and where the Trash put them (Linux; found by their .trashinfo). */
    | { kind: 'trash'; items: Array<{ original: string; trashDir: string; name: string }> }
    /** Files changed in place, each with the snapshot of its previous version and the SHA-256 it had after the change. */
    | { kind: 'snapshots'; items: Array<{ path: string; snapshotId: string; sha256After: string }> }
    /** Reversed by running another operation (power tools: flatten-restore, set-dates with the previous times). */
    | { kind: 'operation'; label: string; request: { type: OperationType; sources: string[]; destination?: string; params?: Record<string, unknown> } }
    | { kind: 'none'; reason: string };
  /** When this operation was undone (undo is offered once). */
  undoneMs?: number;
  summary?: { done: number; skipped: number; failed: number; cancelled: number };
  /** Plain-language notes about the result (e.g. where a backup snapshot was kept). */
  notes?: string[];
  /**
   * Results list individual items inside the sources (folder synchronization) rather
   * than the sources themselves; the runner reports items it never started itself.
   */
  itemResults?: boolean;
  /** Custom actions: the output of each run. */
  output?: ActionRunOutput;
}
