import fsp from 'node:fs/promises';
import type fs from 'node:fs';
import path from 'node:path';
import { makeError } from '../../shared/errors';
import { classifyChange, TIMELINE_LIMITS, type TimelineEntry, type TimelineResult, type TimelineSource } from '../../shared/timeline';
import { extOf } from '../fs/FileSystemService';
import { isWithin } from '../fs/paths';
import { DEFAULT_EXCLUSIONS, type Indexer } from '../search/Indexer';
import type { PauseGate } from '../jobs/PauseGate';
import { TreeWatcher } from '../search/TreeWatcher';

/**
 * Recent changes: files created or modified since a time, across chosen
 * folders. A folder covered by a fully scanned search-index root is answered
 * from the index (each hit re-checked on disk); other folders are scanned live
 * with depth and entry limits, pausable and cancellable. Links are never
 * followed; hidden items and well-known caches are skipped.
 */

const EXCLUDED = DEFAULT_EXCLUSIONS.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));
export const timelineExcluded = (name: string): boolean => EXCLUDED.some((r) => r.test(name));

/** Drop folders inside other chosen folders (they would be listed twice). */
export function topFolders(folders: string[]): string[] {
  const uniq = [...new Set(folders.map((f) => path.resolve(f)))];
  return uniq.filter((f) => !uniq.some((o) => o !== f && isWithin(o, f)));
}

function hiddenBelow(folder: string, p: string): boolean {
  return path.relative(folder, p).split(path.sep).some((seg) => seg.startsWith('.'));
}

export async function entryFor(p: string, folder: string, sinceMs: number, st?: fs.Stats): Promise<TimelineEntry | undefined> {
  const s = st ?? (await fsp.lstat(p).catch(() => undefined));
  if (!s?.isFile()) return undefined;
  const c = classifyChange(s.mtimeMs, s.birthtimeMs > 0 ? s.birthtimeMs : undefined, sinceMs);
  if (!c) return undefined;
  const name = path.basename(p);
  return { path: p, name, ext: extOf(name), folder, dir: path.dirname(p), size: s.size, modifiedMs: s.mtimeMs, createdMs: s.birthtimeMs > 0 ? s.birthtimeMs : undefined, atMs: c.atMs, event: c.event };
}

export interface TimelineOptions {
  folders: string[];
  sinceMs: number;
  indexer?: Indexer;
  useIndex: boolean;
  maxDepth?: number;
  maxEntries?: number;
  limit?: number;
  showHidden?: boolean;
  signal: AbortSignal;
  gate?: PauseGate;
  progress?: (p: { checked: number; found: number; folder: string }) => void;
}

export async function recentChanges(opts: TimelineOptions): Promise<TimelineResult> {
  const maxDepth = Math.max(0, Math.min(opts.maxDepth ?? TIMELINE_LIMITS.maxDepth, 64));
  const maxEntries = Math.max(1, opts.maxEntries ?? TIMELINE_LIMITS.maxEntries);
  const limit = Math.max(1, Math.min(opts.limit ?? TIMELINE_LIMITS.limit, 100_000));
  const sources: TimelineSource[] = [];
  let found: TimelineEntry[] = [];
  let checked = 0;
  const trim = () => {
    if (found.length > limit * 2) found = found.sort((a, b) => b.atMs - a.atMs).slice(0, limit);
  };
  for (const folder of topFolders(opts.folders)) {
    if (opts.signal.aborted) throw makeError('cancelled', 'timeline');
    const st = await fsp.stat(folder).catch(() => undefined);
    if (!st?.isDirectory()) {
      sources.push({ folder, via: 'scan', complete: false, scanned: 0, note: 'This folder is not available.' });
      continue;
    }
    const covering = opts.useIndex ? opts.indexer?.coveringRoot(folder) : undefined;
    if (covering && opts.indexer) {
      const rows = opts.indexer.changedSince(folder, opts.sinceMs, limit * 2);
      let n = 0;
      for (const r of rows) {
        if (opts.gate?.isPaused) await opts.gate.wait();
        if (opts.signal.aborted) throw makeError('cancelled', 'timeline');
        if (!opts.showHidden && hiddenBelow(folder, r.path)) continue;
        const e = await entryFor(r.path, folder, opts.sinceMs); // re-checked on disk: the index can lag behind
        n++;
        if (e) found.push(e);
        trim();
      }
      checked += n;
      opts.progress?.({ checked, found: found.length, folder });
      sources.push({ folder, via: 'index', complete: rows.length < limit * 2, scanned: n, note: rows.length >= limit * 2 ? `Only the ${limit * 2} most recent indexed changes were checked.` : undefined });
      continue;
    }
    // Live scan, breadth first so shallow (likely more relevant) folders come first under the limits.
    const queue: Array<{ dir: string; depth: number }> = [{ dir: folder, depth: 0 }];
    let scanned = 0;
    let depthCut = false;
    let complete = true;
    let unreadable = 0;
    while (queue.length) {
      if (opts.gate?.isPaused) await opts.gate.wait();
      if (opts.signal.aborted) throw makeError('cancelled', 'timeline');
      if (scanned >= maxEntries) {
        complete = false;
        break;
      }
      const { dir, depth } = queue.shift()!;
      let ents: fs.Dirent[];
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        unreadable++;
        continue;
      }
      for (const d of ents) {
        if (scanned >= maxEntries) {
          complete = false; // items left in this folder were not checked
          break;
        }
        if ((!opts.showHidden && d.name.startsWith('.')) || timelineExcluded(d.name)) continue;
        const p = path.join(dir, d.name);
        scanned++;
        checked++;
        if (d.isDirectory()) {
          if (depth + 1 <= maxDepth) queue.push({ dir: p, depth: depth + 1 });
          else depthCut = true;
        } else if (d.isFile()) {
          const e = await entryFor(p, folder, opts.sinceMs);
          if (e) found.push(e);
          trim();
        }
      }
      if (scanned % 500 < ents.length) opts.progress?.({ checked, found: found.length, folder });
    }
    const notes: string[] = [];
    if (!complete) notes.push(`Stopped after ${maxEntries.toLocaleString()} items; deeper or later folders were not checked.`);
    if (depthCut) notes.push(`Folders more than ${maxDepth} levels deep were not checked.`);
    if (unreadable) notes.push(`${unreadable} folder${unreadable === 1 ? '' : 's'} could not be read.`);
    sources.push({ folder, via: 'scan', complete: complete && !depthCut && !unreadable, scanned, note: notes.join(' ') || undefined });
    opts.progress?.({ checked, found: found.length, folder });
  }
  found.sort((a, b) => b.atMs - a.atMs);
  const seen = new Set<string>();
  const entries = found.filter((e) => (seen.has(e.path) ? false : (seen.add(e.path), true)));
  return { entries: entries.slice(0, limit), sources, truncated: entries.length > limit, sinceMs: opts.sinceMs };
}

/**
 * Watches the timeline's folders while the view is open and reports changed
 * files (debounced). Uses one watcher per folder (capped), like the indexer
 * on Linux; links are not followed.
 */
export class TimelineWatcher {
  private watchers: TreeWatcher[] = [];
  private changed = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly folders: string[],
    private readonly sinceMs: () => number,
    private readonly onUpdate: (u: { entries: TimelineEntry[]; removed: string[] }) => void,
    private readonly opts: { debounceMs?: number; maxDirs?: number } = {},
  ) {}

  async start(): Promise<void> {
    for (const f of topFolders(this.folders)) {
      const w = new TreeWatcher(f, (p) => this.note(p), { maxDirs: this.opts.maxDirs ?? 1000, exclude: (n) => n.startsWith('.') || timelineExcluded(n) });
      this.watchers.push(w);
      await w.start();
    }
  }

  get capped(): boolean {
    return this.watchers.some((w) => w.capped);
  }

  private note(p: string): void {
    if (this.closed) return;
    const name = path.basename(p);
    if (name.startsWith('.') || timelineExcluded(name)) return;
    this.changed.add(p);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs ?? 500);
  }

  private async flush(): Promise<void> {
    const paths = [...this.changed];
    this.changed.clear();
    const entries: TimelineEntry[] = [];
    const removed: string[] = [];
    const roots = topFolders(this.folders);
    for (const p of paths.slice(0, 2000)) {
      const folder = roots.find((r) => isWithin(r, p));
      if (!folder) continue;
      const st = await fsp.lstat(p).catch(() => undefined);
      if (!st) {
        removed.push(p);
        continue;
      }
      const e = await entryFor(p, folder, this.sinceMs(), st);
      if (e) entries.push(e);
    }
    if (!this.closed && (entries.length || removed.length)) this.onUpdate({ entries, removed });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
