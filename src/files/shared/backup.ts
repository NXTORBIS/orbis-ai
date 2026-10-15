import { z } from 'zod';
import { ScheduleSchema, type Schedule } from './schedule';

/**
 * Backups with versions: shared types, validated shapes (IPC boundary) and the
 * retention policy (pure, tested). The engine lives in src/main/backup.
 *
 * Store format (docs/ARCHITECTURE.md "Backup store"): a store folder holds
 * `orbis-backup.json` and one folder per run named `YYYY-MM-DD_HHMMSS`; each
 * complete version has `.orbis-manifest.json`, written last and atomically.
 */

const patternStr = z.string().trim().min(1).max(512).refine((s) => !s.includes('\0'), 'Patterns cannot contain a null character.');
const pathStr = z.string().min(1).max(32767).refine((s) => !s.includes('\0'), 'Paths cannot contain a null character.');

export const BackupOptionsSchema = z.object({
  /** Glob patterns (same syntax as folder synchronization); when given, only matching items are backed up. */
  include: z.array(patternStr).max(200).default([]),
  /** Items (and folders with everything inside) that are not backed up. */
  exclude: z.array(patternStr).max(200).default([]),
  /** Leave out items whose name starts with a dot. */
  skipHidden: z.boolean().default(false),
  /** Re-read every new copy and compare its SHA-256 with the source's. */
  verify: z.boolean().default(false),
  /** Also compare contents (SHA-256) of files whose size and modification time did not change. Reads every file. */
  compareContents: z.boolean().default(false),
});
export type BackupOptions = z.infer<typeof BackupOptionsSchema>;
export const DEFAULT_BACKUP_OPTIONS: BackupOptions = BackupOptionsSchema.parse({});

/**
 * Which complete versions are kept after each run. A version is kept when ANY
 * rule keeps it; the newest complete version is always kept. All three at 0
 * means "keep every version" (nothing is ever removed).
 */
export const RetentionSchema = z.object({
  /** The N newest complete versions. */
  keepLast: z.number().int().min(0).max(10_000).default(10),
  /** The newest version of each of the last D calendar days (today is day 1). */
  keepDailyDays: z.number().int().min(0).max(3650).default(7),
  /** The newest version of each of the last W weeks (Monday to Sunday; this week is week 1). */
  keepWeeklyWeeks: z.number().int().min(0).max(520).default(4),
});
export type Retention = z.infer<typeof RetentionSchema>;
export const DEFAULT_RETENTION: Retention = RetentionSchema.parse({});

export const BackupJobInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(128),
  sources: z.array(pathStr).min(1).max(32),
  destination: pathStr,
  options: BackupOptionsSchema,
  retention: RetentionSchema,
  schedule: ScheduleSchema,
});
export type BackupJobInput = z.input<typeof BackupJobInputSchema>;

export interface BackupRunResult {
  state: string;
  finishedMs: number;
  version?: string;
  files?: number;
  newFiles?: number;
  changedFiles?: number;
  copiedBytes?: number;
  errors?: number;
  removedVersions?: number;
  /** Scheduled runs: started by the schedule (not by "Run now"). */
  scheduled?: boolean;
  message?: string;
}

export interface BackupJob {
  id: string;
  name: string;
  sources: string[];
  destination: string;
  /** The backup store: a folder inside the destination, fixed when the job is created. */
  storePath: string;
  options: BackupOptions;
  retention: Retention;
  schedule: Schedule;
  createdMs: number;
  updatedMs: number;
  lastRunMs?: number;
  lastResult?: BackupRunResult;
  /** Filled in by the service for the window. */
  nextRunMs?: number;
  running?: boolean;
  operationId?: string;
}

export type StorageMode = 'hardlink' | 'objects';

/** One entry of a version manifest (short keys keep large manifests small). */
export interface ManifestEntry {
  /** Path inside the version: "<source label>/<relative path>", '/'-separated. */
  p: string;
  /** f file, d folder, l symbolic link (never followed; the link itself is kept). */
  k: 'f' | 'd' | 'l';
  /** Bytes (files). */
  s?: number;
  /** Modification time of the source (ms). */
  m: number;
  /** SHA-256 of the contents (files). */
  h?: string;
  /** Link target (links). */
  t?: string;
  /** Permission bits. */
  mo?: number;
  /** Files: n new, c changed, u unchanged since the previous complete version. */
  x?: 'n' | 'c' | 'u';
}

export interface VersionStats {
  files: number;
  directories: number;
  symlinks: number;
  bytes: number;
  newFiles: number;
  changedFiles: number;
  unchangedFiles: number;
  /** Files of the previous version that are no longer in the sources. */
  removedFiles: number;
  /** Bytes written by this run (new and changed files). */
  copiedBytes: number;
  /** Unchanged files shared with an earlier version (hard links or stored objects). */
  sharedFiles: number;
  /** Items that could not be read and are missing from this version. */
  errors: number;
  /** Special files (devices, sockets, pipes) that are never backed up. */
  skipped: number;
}

export interface VersionManifest {
  format: 'orbis-backup-manifest';
  formatVersion: 1;
  jobId: string;
  jobName: string;
  version: string;
  startedMs: number;
  finishedMs: number;
  storage: StorageMode;
  /** The complete version unchanged files were taken from. */
  base?: string;
  sources: Array<{ label: string; path: string }>;
  options: BackupOptions;
  stats: VersionStats;
  /** Items that could not be read (at most 200). */
  problems: Array<{ path: string; message: string }>;
  entries: ManifestEntry[];
}

export interface VersionInfo {
  name: string;
  /** From the manifest, or from the folder name for incomplete versions. */
  startedMs: number;
  finishedMs?: number;
  complete: boolean;
  /** Why the version is not usable (no manifest: the run did not finish; unreadable manifest…). */
  problem?: string;
  storage?: StorageMode;
  stats?: VersionStats;
  sources?: Array<{ label: string; path: string }>;
}

export interface BrowseEntry {
  name: string;
  /** Path inside the version. */
  rel: string;
  kind: 'file' | 'directory' | 'symlink';
  size?: number;
  mtimeMs: number;
  status?: 'new' | 'changed' | 'unchanged';
  sha256?: string;
  linkTarget?: string;
  /** Folders: number of items inside, at any depth. */
  items?: number;
}

export interface FileVersionRow {
  version: string;
  startedMs: number;
  present: boolean;
  kind?: BrowseEntry['kind'];
  size?: number;
  mtimeMs?: number;
  sha256?: string;
  status?: BrowseEntry['status'];
}

export interface VerifyResult {
  version: string;
  checked: number;
  ok: number;
  /** Paths whose stored copy does not match the manifest (size or SHA-256). */
  mismatched: string[];
  /** Paths whose stored copy is missing. */
  missing: string[];
  /** Files recorded without a SHA-256 (only the size could be checked). */
  sizeOnly: number;
  durationMs: number;
}

export interface BackupActivity {
  id: string;
  jobId: string;
  ms: number;
  kind: 'run' | 'retention' | 'verify' | 'restore' | 'schedule' | 'cleanup';
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

/** Version folder name of a run started at `ms` (local time): YYYY-MM-DD_HHMMSS. */
export function versionName(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const VERSION_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:-(\d{1,3}))?$/;

/** Local start time encoded in a version folder name, or undefined when it is not one. */
export function parseVersionName(name: string): number | undefined {
  const m = VERSION_NAME_RE.exec(name);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const t = new Date(y, mo - 1, d, h, mi, s, 0);
  if (t.getMonth() !== mo - 1 || t.getDate() !== d) return undefined;
  return t.getTime();
}

function localDayIndex(ms: number): number {
  const d = new Date(ms);
  // Days since an epoch counted in local calendar days (DST-safe: built from the local date).
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Week index of the Monday-to-Sunday week containing `ms` (local time). */
function localWeekIndex(ms: number): number {
  const day = localDayIndex(ms);
  // 1970-01-05 (day 4) was a Monday.
  return Math.floor((day - 4) / 7);
}

export interface RetentionDecision {
  keep: string[];
  remove: string[];
  /** Why each kept version is kept ("last 10", "daily", "weekly", "newest"). */
  reasons: Record<string, string[]>;
}

/**
 * Retention: which COMPLETE versions to keep at `nowMs`. Incomplete versions
 * must not be passed in: they are never counted and never removed by retention.
 *
 *  - keep the newest complete version always;
 *  - keep the `keepLast` newest;
 *  - for each of the last `keepDailyDays` local calendar days (today = 1), keep the newest version of that day;
 *  - for each of the last `keepWeeklyWeeks` Monday–Sunday weeks (this week = 1), keep the newest version of that week;
 *  - every rule at 0: keep everything.
 * Versions dated in the future (clock changes) are always kept.
 */
export function planRetention(versions: Array<{ name: string; startedMs: number }>, policy: Retention, nowMs: number): RetentionDecision {
  const sorted = [...versions].sort((a, b) => b.startedMs - a.startedMs || (a.name < b.name ? 1 : -1));
  const reasons: Record<string, string[]> = {};
  const add = (name: string, why: string) => (reasons[name] ??= []).push(why);
  if (!sorted.length) return { keep: [], remove: [], reasons };
  if (policy.keepLast === 0 && policy.keepDailyDays === 0 && policy.keepWeeklyWeeks === 0) {
    for (const v of sorted) add(v.name, 'keep all');
    return { keep: sorted.map((v) => v.name), remove: [], reasons };
  }
  add(sorted[0]!.name, 'newest');
  sorted.slice(0, policy.keepLast).forEach((v) => add(v.name, `last ${policy.keepLast}`));
  const today = localDayIndex(nowMs);
  const thisWeek = localWeekIndex(nowMs);
  const seenDays = new Set<number>();
  const seenWeeks = new Set<number>();
  for (const v of sorted) {
    if (v.startedMs > nowMs) {
      add(v.name, 'dated in the future');
      continue;
    }
    const day = localDayIndex(v.startedMs);
    if (today - day < policy.keepDailyDays && !seenDays.has(day)) {
      seenDays.add(day);
      add(v.name, 'daily');
    }
    const week = localWeekIndex(v.startedMs);
    if (thisWeek - week < policy.keepWeeklyWeeks && !seenWeeks.has(week)) {
      seenWeeks.add(week);
      add(v.name, 'weekly');
    }
  }
  const keep = sorted.filter((v) => reasons[v.name]).map((v) => v.name);
  const remove = sorted.filter((v) => !reasons[v.name]).map((v) => v.name);
  return { keep, remove, reasons };
}

/** Plain-language summary of a retention policy. */
export function describeRetention(r: Retention): string {
  if (!r.keepLast && !r.keepDailyDays && !r.keepWeeklyWeeks) return 'Keep every version';
  const parts = [
    r.keepLast ? `the last ${r.keepLast}` : '',
    r.keepDailyDays ? `one per day for ${r.keepDailyDays} day${r.keepDailyDays === 1 ? '' : 's'}` : '',
    r.keepWeeklyWeeks ? `one per week for ${r.keepWeeklyWeeks} week${r.keepWeeklyWeeks === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Keep ${parts.join(', ')}`;
}

/** Restore request: items of one version back where they came from, or into a folder. */
export const RestoreRequestSchema = z.object({
  jobId: z.string().min(1).max(128),
  version: z.string().regex(VERSION_NAME_RE, 'Not a backup version name.'),
  /** Paths inside the version: a source folder, a folder or a file. */
  items: z.array(z.string().min(1).max(32767).refine((r) => isSafeVersionRel(r), 'Not a path inside the backup.')).min(1).max(10_000),
  /** 'original': each item back where it was backed up from; 'folder': into `path`. */
  target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('original') }), z.object({ kind: z.literal('folder'), path: pathStr })]),
});
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;

/** True for a path inside a version made only of ordinary name segments joined by '/'. */
export function isSafeVersionRel(rel: string): boolean {
  if (!rel || rel.length > 32767 || rel.includes('\0') || rel.includes('\\')) return false;
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
