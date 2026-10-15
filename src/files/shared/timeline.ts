/**
 * Recent changes timeline: shared types, the created/modified decision and
 * grouping by local day (used by the main process and the view).
 */

export interface TimelineEntry {
  path: string;
  name: string;
  ext: string;
  /** The chosen folder the file was found under. */
  folder: string;
  /** The file's own folder. */
  dir: string;
  size: number;
  modifiedMs: number;
  createdMs?: number;
  /** When the change happened (shown and sorted by). */
  atMs: number;
  event: 'created' | 'modified';
}

export interface TimelineSource {
  folder: string;
  via: 'index' | 'scan';
  complete: boolean;
  scanned: number;
  note?: string;
}

export interface TimelineResult {
  entries: TimelineEntry[];
  sources: TimelineSource[];
  truncated: boolean;
  sinceMs: number;
}

export const TIMELINE_LIMITS = { maxDepth: 8, maxEntries: 200_000, limit: 5000 } as const;

export type TimelinePeriod = 'day' | 'week' | 'month';
export const PERIOD_MS: Record<TimelinePeriod, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

/**
 * Whether a file changed since `sinceMs`, and how: "created" when it was born
 * in the period and not modified noticeably later (2 s), else "modified". A
 * copied or extracted file that kept an old modification time counts as
 * created when the file system records its creation time.
 */
export function classifyChange(modifiedMs: number, createdMs: number | undefined, sinceMs: number): { event: 'created' | 'modified'; atMs: number } | undefined {
  const created = createdMs !== undefined && createdMs >= sinceMs;
  if (created && modifiedMs <= createdMs + 2000) return { event: 'created', atMs: createdMs };
  if (modifiedMs >= sinceMs) return { event: 'modified', atMs: modifiedMs };
  if (created) return { event: 'created', atMs: createdMs };
  return undefined;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Group entries (any order) by local calendar day, newest day first, newest entry first within a day. */
export function groupByDay(entries: TimelineEntry[], nowMs: number, locale?: string): Array<{ key: string; label: string; entries: TimelineEntry[] }> {
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of [...entries].sort((a, b) => b.atMs - a.atMs)) {
    const k = dayKey(e.atMs);
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const today = dayKey(nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = dayKey(yesterday.getTime());
  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: key === today ? 'Today' : key === yKey ? 'Yesterday' : new Date(list[0]!.atMs).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: new Date(list[0]!.atMs).getFullYear() === new Date(nowMs).getFullYear() ? undefined : 'numeric' }),
    entries: list,
  }));
}
