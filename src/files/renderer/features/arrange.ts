import type { FileEntry, GroupKey, SortSpec, Volume } from '../../shared/model';
import type { MediaSummary } from '../../shared/media';
import { categoryOfEntry, kindLabel, naturalCompare } from '../ui/format';

/**
 * Sorting and grouping of folder entries (pure; used by every file view).
 * Multi-key sorting is real: the primary key, then up to three further keys
 * in priority order, then the name. Items without a value for an optional key
 * (tags, embedded metadata) always come last.
 */


export type Row = { type: 'group'; key: string; label: string; count: number } | { type: 'item'; entry: FileEntry };

const isDir = (e: FileEntry) => e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory');

export type TagMap = Record<string, Array<{ id: string; name: string; color: string | null }>>;

/** Extra data some sort/group keys need: catalogue tags and embedded metadata. */
export interface ArrangeData {
  tags?: TagMap;
  meta?: Record<string, MediaSummary>;
  /** Calculated folder totals ("Calculate folder sizes"), used for folders when sorting by size. */
  folderSizes?: Record<string, { bytes: number }>;
}

export type ThenBy = Array<{ key: SortSpec['key']; dir: 'asc' | 'desc' }>;

/**
 * Sort by the primary key, then by up to three further keys in priority
 * order, then by name (natural order) so equal items keep a predictable order.
 * "Folders first" applies before everything else.
 */
export function sortEntries(entries: FileEntry[], sort: SortSpec, data: ArrangeData = {}, thenBy: ThenBy = []): FileEntry[] {
  const firstTag = (e: FileEntry) => data.tags?.[e.path]?.map((t) => t.name.toLowerCase()).sort()[0];
  const pixels = (e: FileEntry) => {
    const m = data.meta?.[e.path];
    return m?.width && m.height ? m.width * m.height : undefined;
  };
  // Optional values (tags, embedded metadata): items without a value always come last.
  const optionalCmp = (x: number | string | undefined, y: number | string | undefined, dir: number): number => {
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 2;
    if (y === undefined) return -2;
    return (typeof x === 'string' ? naturalCompare(x, y as string) : x - (y as number)) * dir;
  };
  // Folders have no size of their own; a calculated total is used when there is one.
  const sizeOf = (e: FileEntry): number => (isDir(e) ? data.folderSizes?.[e.path]?.bytes ?? -1 : e.size ?? -1);
  const byKey = (key: SortSpec['key'], d: 'asc' | 'desc', a: FileEntry, b: FileEntry): number => {
    const dir = d === 'asc' ? 1 : -1;
    const optional = (x: number | string | undefined, y: number | string | undefined) => optionalCmp(x, y, dir);
    let r = 0;
    switch (key) {
      case 'name': r = naturalCompare(a.name, b.name) * dir; break;
      case 'size': r = (sizeOf(a) - sizeOf(b)) * dir; break;
      case 'modified': r = ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * dir; break;
      case 'created': r = ((a.createdMs ?? 0) - (b.createdMs ?? 0)) * dir; break;
      case 'accessed': r = ((a.accessedMs ?? 0) - (b.accessedMs ?? 0)) * dir; break;
      case 'type': r = naturalCompare(kindLabel(a), kindLabel(b)) * dir; break;
      case 'ext': r = naturalCompare(a.ext, b.ext) * dir; break;
      case 'tags': r = optional(firstTag(a), firstTag(b)); break;
      case 'dimensions': r = optional(pixels(a), pixels(b)); break;
      case 'duration': r = optional(data.meta?.[a.path]?.durationSec, data.meta?.[b.path]?.durationSec); break;
      case 'taken': r = optional(data.meta?.[a.path]?.takenAt, data.meta?.[b.path]?.takenAt); break;
    }
    return r;
  };
  const cmp = (a: FileEntry, b: FileEntry): number => {
    if (sort.foldersFirst && isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
    let r = byKey(sort.key, sort.dir, a, b);
    for (const t of thenBy) {
      if (r !== 0) break;
      r = byKey(t.key, t.dir, a, b);
    }
    // Stable tie-break by name so equal keys keep a predictable order.
    return r !== 0 ? r : naturalCompare(a.name, b.name);
  };
  return [...entries].sort(cmp);
}

const DAY = 86400000;
function dateBucket(ms?: number): [string, string] {
  if (!ms) return ['9', 'Unknown date'];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= start) return ['0', 'Today'];
  if (ms >= start - DAY) return ['1', 'Yesterday'];
  if (ms >= start - 7 * DAY) return ['2', 'Earlier this week'];
  if (ms >= start - 30 * DAY) return ['3', 'Earlier this month'];
  if (ms >= new Date(now.getFullYear(), 0, 1).getTime()) return ['4', 'Earlier this year'];
  return [`5-${9999 - new Date(ms).getFullYear()}`, String(new Date(ms).getFullYear())];
}
function sizeBucket(e: FileEntry): [string, string] {
  if (isDir(e)) return ['0', 'Folders'];
  const s = e.size;
  if (s === undefined) return ['9', 'Unknown size'];
  if (s === 0) return ['1', 'Empty'];
  if (s < 100 * 1024) return ['2', 'Tiny (under 100 KB)'];
  if (s < 10 * 1024 ** 2) return ['3', 'Small (under 10 MB)'];
  if (s < 1024 ** 3) return ['4', 'Medium (under 1 GB)'];
  return ['5', 'Large (1 GB and over)'];
}

export function arrange(entries: FileEntry[], sort: SortSpec, groupBy: GroupKey, filter: string, data: ArrangeData = {}, thenBy: ThenBy = []): Row[] {
  const f = filter.trim().toLowerCase();
  const visible = f ? entries.filter((e) => e.name.toLowerCase().includes(f)) : entries;
  const sorted = sortEntries(visible, sort, data, thenBy);
  if (groupBy === 'none') return sorted.map((entry) => ({ type: 'item', entry }));
  const groups = new Map<string, { label: string; items: FileEntry[] }>();
  for (const e of sorted) {
    let key: string;
    let label: string;
    if (groupBy === 'type') key = label = kindLabel(e);
    else if (groupBy === 'kind') [key, label] = [categoryOfEntry(e), categoryOfEntry(e).replace(/^\w/, (c) => c.toUpperCase())];
    else if (groupBy === 'modified') [key, label] = dateBucket(e.modifiedMs);
    else if (groupBy === 'created') [key, label] = e.createdMs === undefined ? ['9', 'Creation date not recorded'] : dateBucket(e.createdMs);
    else if (groupBy === 'tags') {
      // An item with several tags is listed under its alphabetically first tag.
      const t = data.tags?.[e.path]?.map((x) => x.name).sort((a, b) => naturalCompare(a, b))[0];
      [key, label] = t ? [`0-${t.toLowerCase()}`, `Tag: ${t}`] : ['9', 'No tags'];
    } else [key, label] = sizeBucket(e);
    const g = groups.get(key) ?? { label, items: [] };
    g.items.push(e);
    groups.set(key, g);
  }
  const rows: Row[] = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => naturalCompare(a[0], b[0]))) {
    rows.push({ type: 'group', key, label: g.label, count: g.items.length });
    for (const entry of g.items) rows.push({ type: 'item', entry });
  }
  return rows;
}


/** The drive or volume an item is on, from the real mount table (longest matching mount point). */
/** The entries a file view shows, in the order it shows them (filtered, sorted and grouped like the pane). */
export function shownEntries(entries: FileEntry[], view: { sort: SortSpec; groupBy: GroupKey; filter: string; thenBy?: ThenBy }, data: ArrangeData = {}): FileEntry[] {
  return arrange(entries, view.sort, view.groupBy, view.filter, data, view.thenBy ?? []).flatMap((r) => (r.type === 'item' ? [r.entry] : []));
}

/** `paths` in the order the view shows them; paths it does not show keep their order at the end. */
export function inShownOrder(paths: string[], shown: FileEntry[]): string[] {
  const rank = new Map(shown.map((e, i) => [e.path, i]));
  return paths.map((p, i) => ({ p, i, r: rank.get(p) ?? Number.MAX_SAFE_INTEGER })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p);
}

export function volumeOf(p: string, volumes: Volume[]): Volume | undefined {
  let best: Volume | undefined;
  for (const v of volumes) {
    const m = v.mountPath;
    const prefix = m.endsWith('/') || m.endsWith('\\') ? m : m + (m.includes('\\') ? '\\' : '/');
    if ((p === m || p.startsWith(prefix)) && (!best || m.length > best.mountPath.length)) best = v;
  }
  return best;
}
