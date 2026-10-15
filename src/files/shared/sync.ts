import { z } from 'zod';

/**
 * Folder synchronization: shared types and the validated shapes used at the
 * IPC boundary. The engine lives in src/main/sync.
 *
 * Paths inside a plan are relative, '/'-separated and never contain '.', '..'
 * or empty segments (see `isSafeRel`).
 */

export const SYNC_MODES = ['mirror', 'update', 'two-way'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];
export const SyncModeSchema = z.enum(SYNC_MODES);

const patternStr = z.string().trim().min(1).max(512).refine((s) => !s.includes('\0'), 'Patterns cannot contain a null character.');

export const SyncOptionsSchema = z.object({
  /** Glob patterns; when any are given, only matching items (and everything inside matching folders) are synchronized. */
  include: z.array(patternStr).max(200).default([]),
  /** Glob patterns for items (and folders with everything inside) that are left alone on both sides. */
  exclude: z.array(patternStr).max(200).default([]),
  /** Leave items whose name starts with a dot alone. */
  skipHidden: z.boolean().default(false),
  /** Compare contents by SHA-256 when size and time do not settle it, and re-read every copied file to verify it. */
  verify: z.boolean().default(false),
  /** Modification times this close are treated as equal (FAT stores times in 2 s steps; some network drives round too). */
  mtimeToleranceMs: z.number().int().min(0).max(3_600_000).default(2000),
  /** Symbolic links are never followed. 'skip' leaves them alone; 'copy-as-link' recreates the link itself. */
  symlinks: z.enum(['skip', 'copy-as-link']).default('skip'),
  /** Move the version a copy replaces to the Trash instead of overwriting it. */
  trashReplaced: z.boolean().default(true),
});
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;
export type SyncOptionsInput = z.input<typeof SyncOptionsSchema>;
export const DEFAULT_SYNC_OPTIONS: SyncOptions = SyncOptionsSchema.parse({});

export const CONFLICT_CHOICES = ['left', 'right', 'both', 'skip'] as const;
export type ConflictChoice = (typeof CONFLICT_CHOICES)[number];
export const ConflictChoiceSchema = z.enum(CONFLICT_CHOICES);

export type SyncSide = 'left' | 'right';
export type SyncItemKind = 'file' | 'directory' | 'symlink';
export type SyncActionKind = 'copy' | 'update' | 'delete' | 'conflict';

/** What was seen on one side when the plan was made. */
export interface SyncEntryInfo {
  kind: SyncItemKind;
  /** Bytes (files only). */
  size?: number;
  mtimeMs: number;
  /** Symbolic links: where the link points (never followed). */
  linkTarget?: string;
}

export type SyncConflictType =
  /** Changed on both sides since the last synchronization (two-way). */
  | 'changed-both'
  /** Present on both sides with different contents and no earlier synchronization to tell which is newer (two-way). */
  | 'created-both'
  /** Deleted on one side and changed on the other since the last synchronization (two-way). */
  | 'deleted-changed'
  /** One-way: the copy in the target folder is newer than the source. */
  | 'target-newer'
  /** One-way: same modification time, different size or contents. */
  | 'same-time'
  /** A file on one side and a folder or link on the other. */
  | 'kind'
  /** Names that differ only in letter case where one folder ignores case. */
  | 'case';

export interface SyncAction {
  /** Index within the plan; conflict decisions refer to it. */
  id: number;
  /** Display path (relative, '/'-separated; the left spelling when the item exists on the left). */
  rel: string;
  kind: SyncItemKind;
  action: SyncActionKind;
  /** copy/update: the side written to. delete: the side the item is removed from (to the Trash). */
  to?: SyncSide;
  reason: string;
  /** Bytes to copy (copy/update), bytes moved to the Trash (delete), or the larger version (conflict). */
  bytes: number;
  /** Folders removed as a whole: number of items inside them. */
  items?: number;
  left?: SyncEntryInfo;
  right?: SyncEntryInfo;
  conflict?: SyncConflictType;
  /** Choices the conflict accepts. */
  choices?: ConflictChoice[];
}

export interface SyncGroupTotals {
  count: number;
  bytes: number;
}

export interface SyncPlan {
  planId: string;
  pairId?: string;
  left: string;
  right: string;
  mode: SyncMode;
  options: SyncOptions;
  createdMs: number;
  /** Actions (up to SYNC_PLAN_ROWS_MAX are sent; `truncated` says when more exist). */
  actions: SyncAction[];
  truncated: boolean;
  groups: Record<SyncActionKind, SyncGroupTotals>;
  /** Items already the same on both sides. */
  inSync: number;
  /** Items left alone by include/exclude patterns or "skip hidden". */
  excluded: number;
  symlinksSkipped: number;
  /** Devices, sockets, pipes: never synchronized. */
  specialSkipped: number;
  /** One-way "update": items only in the target that are kept. */
  extraKept: number;
  /** Items inside a conflicting or unreadable item, not compared. */
  notCompared: number;
  /** Locations that could not be read; nothing below them is changed. */
  unreadable: string[];
  complete: boolean;
  caseInsensitive: boolean;
  /** Two-way: the stored state of the last synchronization that this plan compared against. */
  baseline?: { entries: number; updatedMs: number };
  trashAvailable: boolean;
  notes: string[];
}

export interface SyncRunSummary {
  state: string;
  finishedMs: number;
  done: number;
  skipped: number;
  failed: number;
  cancelled: number;
  /** Items skipped because they changed after the preview. */
  changedSincePreview: number;
}

export interface SyncPair {
  id: string;
  name: string;
  left: string;
  right: string;
  mode: SyncMode;
  options: SyncOptions;
  createdMs: number;
  updatedMs: number;
  lastRunMs?: number;
  lastSummary?: SyncRunSummary;
}

/** Most plan rows sent to the window; the full plan stays in the main process. */
export const SYNC_PLAN_ROWS_MAX = 20000;

/** True for a relative path made only of ordinary name segments joined by '/'. */
export function isSafeRel(rel: string): boolean {
  if (!rel || rel.length > 32767 || rel.includes('\0') || rel.includes('\\')) return false;
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** "report.txt" → "report (conflict 2026-10-11).txt"; `n` > 1 adds a number. */
export function conflictName(name: string, date: Date, n = 1): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${stem} (conflict ${stamp}${n > 1 ? ` ${n}` : ''})${ext}`;
}
