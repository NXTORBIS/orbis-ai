import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppDatabase } from '../store/Database';
import type { Candidate } from './query';
import { extOf } from '../fs/FileSystemService';
import { isWithin } from '../fs/paths';
import { TreeWatcher } from './TreeWatcher';
import { isTextLike, readSmallText } from './SearchEngine';
import { makeError } from '../../shared/errors';
import { subsequenceLike } from '../../shared/fuzzy';

/**
 * Local, incremental filename (and optional content) index.
 *
 * Freshness strategy — filesystem notifications alone are not trusted:
 *  1. Full reconciliation scan per root (adds, updates, and removes rows not seen).
 *  2. `touch()` after every operation Orbis Files performs (copy, move, rename…).
 *  3. Change notifications: native recursive fs.watch on macOS and Windows; on
 *     Linux a TreeWatcher with one watcher per folder (capped, reported).
 *  4. Periodic reconciliation (default every 15 minutes).
 *
 * The index is stored locally in the application database and never uploaded.
 */

export interface IndexStatus {
  state: 'idle' | 'scanning' | 'paused' | 'error';
  roots: Array<{ path: string; entries: number; lastFullScanMs: number | null; lastError: string | null; available: boolean }>;
  currentRoot?: string;
  scanned: number;
  contentEnabled: boolean;
  exclusions: string[];
  watchMode: 'recursive' | 'per-folder' | 'root-only';
  /** Linux: folders watched across all roots, and whether a cap left some unwatched. */
  watchedFolders?: number;
  watchCapped?: boolean;
}

export const DEFAULT_EXCLUSIONS = ['node_modules', '.git', '.cache', '.Trash*', '$RECYCLE.BIN', 'System Volume Information', '.orbis-part-*'];

type Row = Candidate & { root: string; parent: string };

export class Indexer extends EventEmitter {
  private state: IndexStatus['state'] = 'idle';
  private currentRoot: string | undefined;
  private scanned = 0;
  private abort: AbortController | undefined;
  private paused = false;
  private resumeWaiters: Array<() => void> = [];
  private queue: string[] = [];
  private running: Promise<void> | undefined;
  private watchers = new Map<string, { close(): void }>();
  private treeWatchers = new Map<string, TreeWatcher>();
  /** Per-folder watcher budget per root on Linux. */
  maxWatchedFolders = 4000;
  private touchTimer: NodeJS.Timeout | undefined;
  private touchPending = new Set<string>();
  private reconcileTimer: NodeJS.Timeout | undefined;
  contentEnabled = false;
  exclusions: RegExp[] = [];
  private exclusionSources: string[] = [];

  constructor(private readonly db: AppDatabase, private readonly kv: { get: <T>(k: string, f: T) => T; set: (k: string, v: unknown) => void }) {
    super();
    this.setExclusions(kv.get<string[]>('index.exclusions', DEFAULT_EXCLUSIONS));
  }

  setExclusions(patterns: string[]): void {
    this.exclusionSources = patterns.filter((p) => p.trim()).slice(0, 1000);
    this.exclusions = this.exclusionSources.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
    this.kv.set('index.exclusions', this.exclusionSources);
    this.emitStatus();
  }

  private excluded(name: string): boolean {
    return this.exclusions.some((r) => r.test(name));
  }

  roots(): string[] {
    return this.db.all<{ path: string }>('SELECT path FROM index_roots ORDER BY path').map((r) => r.path);
  }

  /** The index root that fully covers `p`, if any. */
  coveringRoot(p: string): string | undefined {
    return this.roots().find((r) => isWithin(r, p) && this.db.get<{ last_full_scan_ms: number | null }>('SELECT last_full_scan_ms FROM index_roots WHERE path = ?', [r])?.last_full_scan_ms != null);
  }

  *entriesUnder(p: string): Generator<Row> {
    const prefix = p.endsWith(path.sep) ? p : p + path.sep;
    const rows = this.db.all<{ path: string; root: string; parent: string; name: string; ext: string; kind: string; size: number | null; mtime_ms: number | null; ctime_ms: number | null; content: string | null }>(
      'SELECT path, root, parent, name, ext, kind, size, mtime_ms, ctime_ms, content FROM index_entries WHERE path = ? OR substr(path, 1, ?) = ?',
      [p, prefix.length, prefix],
    );
    for (const r of rows) {
      if (r.path === p) continue;
      yield {
        path: r.path, root: r.root, parent: r.parent, name: r.name, ext: r.ext, kind: r.kind as Row['kind'],
        size: r.size ?? undefined, modifiedMs: r.mtime_ms ?? undefined, createdMs: r.ctime_ms ?? undefined, content: r.content,
      };
    }
  }

  /**
   * Indexed items whose name contains every query word, in order, as a
   * subsequence ("rpt" finds "report.pdf"), for the quick switcher. Exact
   * names, then name prefixes, then names containing the text come first;
   * at most `limit` rows. The caller ranks them and checks each on disk.
   */
  quickFind(query: string, opts: { limit?: number; showHidden?: boolean } = {}): Array<{ path: string; name: string; kind: string }> {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return [];
    const q = words.join(' ');
    const esc = (t: string) => t.replace(/[%_\\]/g, (c) => `\\${c}`);
    const where = words.map(() => "name_lc LIKE ? ESCAPE '\\'").join(' AND ');
    const hidden = opts.showHidden ? '' : " AND name NOT LIKE '.%'";
    return this.db.all<{ path: string; name: string; kind: string }>(
      `SELECT path, name, kind FROM index_entries WHERE ${where}${hidden}
       ORDER BY CASE WHEN name_lc = ? THEN 0 WHEN name_lc LIKE ? ESCAPE '\\' THEN 1 WHEN name_lc LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END, length(name_lc)
       LIMIT ?`,
      [...words.map(subsequenceLike), q, `${esc(q)}%`, `%${esc(q)}%`, Math.max(1, Math.min(opts.limit ?? 400, 2000))],
    );
  }

  /**
   * Indexed files below `folder` modified or created at or after `sinceMs`,
   * newest first (at most `limit` rows). Used by the Recent changes timeline;
   * the caller re-checks each one on disk.
   */
  changedSince(folder: string, sinceMs: number, limit: number): Array<{ path: string; name: string; ext: string; size: number | null; mtime_ms: number | null; ctime_ms: number | null }> {
    const prefix = folder.endsWith(path.sep) ? folder : folder + path.sep;
    return this.db.all(
      `SELECT path, name, ext, size, mtime_ms, ctime_ms FROM index_entries
       WHERE kind = 'file' AND substr(path, 1, ?) = ? AND (mtime_ms >= ? OR ctime_ms >= ?)
       ORDER BY MAX(COALESCE(mtime_ms, 0), COALESCE(ctime_ms, 0)) DESC LIMIT ?`,
      [prefix.length, prefix, sinceMs, sinceMs, Math.max(1, Math.min(limit, 100_000))],
    );
  }

  async addRoot(p: string): Promise<void> {
    const st = await fsp.stat(p).catch(() => undefined);
    if (!st?.isDirectory()) throw makeError('not_a_directory', 'index.addRoot', { target: p });
    const existing = this.roots();
    if (existing.some((r) => isWithin(r, p))) throw makeError('already_exists', 'index.addRoot', { message: 'This folder is already inside an indexed folder.' });
    this.db.tx(() => {
      // A new root that contains existing roots replaces them.
      for (const r of existing) if (isWithin(p, r)) {
        this.db.run('DELETE FROM index_entries WHERE root = ?', [r]);
        this.db.run('DELETE FROM index_roots WHERE path = ?', [r]);
      }
      this.db.run('INSERT INTO index_roots(path, added_ms) VALUES(?, ?)', [p, Date.now()]);
    });
    this.watchRoot(p);
    this.enqueue(p);
  }

  removeRoot(p: string): void {
    this.watchers.get(p)?.close();
    this.watchers.delete(p);
    this.treeWatchers.delete(p);
    this.queue = this.queue.filter((q) => q !== p);
    if (this.currentRoot === p) this.abort?.abort();
    this.db.tx(() => {
      this.db.run('DELETE FROM index_entries WHERE root = ?', [p]);
      this.db.run('DELETE FROM index_roots WHERE path = ?', [p]);
    });
    this.emitStatus();
  }

  start(reconcileMinutes = 15): void {
    for (const r of this.roots()) this.watchRoot(r);
    const stale = this.db.all<{ path: string }>('SELECT path FROM index_roots WHERE last_full_scan_ms IS NULL OR last_full_scan_ms < ?', [Date.now() - reconcileMinutes * 60000]);
    for (const r of stale) this.enqueue(r.path);
    clearInterval(this.reconcileTimer);
    this.reconcileTimer = setInterval(() => this.rebuild(), reconcileMinutes * 60000);
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    clearInterval(this.reconcileTimer);
    clearTimeout(this.touchTimer);
    clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
    this.stopped = true;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    this.treeWatchers.clear();
    this.abort?.abort();
    this.resume();
  }

  rebuild(): void {
    for (const r of this.roots()) this.enqueue(r);
  }

  pause(): void {
    if (this.state === 'scanning') {
      this.paused = true;
      this.state = 'paused';
      this.emitStatus();
    }
  }

  resume(): void {
    this.paused = false;
    if (this.state === 'paused') this.state = 'scanning';
    const w = this.resumeWaiters;
    this.resumeWaiters = [];
    w.forEach((r) => r());
    this.emitStatus();
  }

  private async gate(signal: AbortSignal): Promise<void> {
    while (this.paused && !signal.aborted) await new Promise<void>((r) => this.resumeWaiters.push(r));
  }

  private enqueue(root: string): void {
    if (!this.queue.includes(root) && this.currentRoot !== root) this.queue.push(root);
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
    });
  }

  /** Wait for queued scans (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const root = this.queue.shift()!;
      this.abort = new AbortController();
      this.currentRoot = root;
      this.state = this.paused ? 'paused' : 'scanning';
      this.scanned = 0;
      this.emitStatus();
      try {
        await this.scanRoot(root, this.abort.signal);
        this.db.run('UPDATE index_roots SET last_full_scan_ms = ?, last_error = NULL WHERE path = ?', [Date.now(), root]);
      } catch (err) {
        this.db.run('UPDATE index_roots SET last_error = ? WHERE path = ?', [(err as Error).message ?? 'scan failed', root]);
      }
      this.currentRoot = undefined;
    }
    this.state = 'idle';
    this.emitStatus();
    this.emit('idle');
  }

  /** Reconciliation scan: upsert everything found, then delete rows for this root that were not seen. */
  private async scanRoot(root: string, signal: AbortSignal): Promise<void> {
    const st = await fsp.stat(root).catch(() => undefined);
    if (!st?.isDirectory()) throw new Error('Indexed folder is not available (moved, deleted or disconnected).');
    const seen = new Set<string>();
    const stack = [root];
    const visited = new Set<string>([`${st.dev}:${st.ino}`]);
    let batch: Row[] = [];
    const commit = () => {
      if (!batch.length) return;
      const rows = batch;
      batch = [];
      this.db.tx(() => {
        for (const r of rows) {
          this.db.run(
            `INSERT INTO index_entries(path, root, parent, name, name_lc, ext, kind, size, mtime_ms, ctime_ms, content)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET root=excluded.root, parent=excluded.parent, name=excluded.name, name_lc=excluded.name_lc,
               ext=excluded.ext, kind=excluded.kind, size=excluded.size, mtime_ms=excluded.mtime_ms, ctime_ms=excluded.ctime_ms,
               content=CASE WHEN excluded.content IS NOT NULL OR index_entries.mtime_ms IS NOT excluded.mtime_ms THEN excluded.content ELSE index_entries.content END`,
            [r.path, r.root, r.parent, r.name, r.name.toLowerCase(), r.ext, r.kind, r.size ?? null, r.modifiedMs ?? null, r.createdMs ?? null, r.content ?? null],
          );
        }
      });
      this.emitStatus();
    };
    const known = new Map(this.db.all<{ path: string; mtime_ms: number | null; has: number }>('SELECT path, mtime_ms, content IS NOT NULL AS has FROM index_entries WHERE root = ?', [root]).map((r) => [r.path, r]));
    while (stack.length) {
      if (signal.aborted) throw new Error('Scan cancelled.');
      await this.gate(signal);
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable folder: its previous rows are removed below because they are not seen
      }
      for (const d of entries) {
        if (this.excluded(d.name)) continue;
        const p = path.join(dir, d.name);
        let s: fs.Stats;
        try {
          s = await fsp.lstat(p);
        } catch {
          continue;
        }
        seen.add(p);
        this.scanned++;
        const kind: Row['kind'] = s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other';
        const ext = kind === 'directory' ? '' : extOf(d.name);
        const prev = known.get(p);
        let content: string | null = null;
        if (this.contentEnabled && kind === 'file' && isTextLike(ext) && (!prev || prev.mtime_ms !== s.mtimeMs || !prev.has)) {
          content = await readSmallText(p);
        }
        batch.push({ path: p, root, parent: dir, name: d.name, ext, kind, size: kind === 'file' ? s.size : undefined, modifiedMs: s.mtimeMs, createdMs: s.birthtimeMs > 0 ? s.birthtimeMs : undefined, content });
        if (kind === 'directory') {
          const key = `${s.dev}:${s.ino}`;
          if (!visited.has(key)) {
            visited.add(key);
            stack.push(p);
          }
        }
        if (batch.length >= 500) commit();
      }
    }
    commit();
    if (!this.contentEnabled) this.db.run('UPDATE index_entries SET content = NULL WHERE root = ? AND content IS NOT NULL', [root]);
    const stale = [...known.keys()].filter((p) => !seen.has(p));
    if (stale.length) this.db.tx(() => stale.forEach((p) => this.db.run('DELETE FROM index_entries WHERE path = ?', [p])));
  }

  /** Re-check specific paths (after an operation or a watch event). Removes rows for vanished paths. */
  touch(paths: string[]): void {
    const roots = this.roots();
    for (const p of paths) if (roots.some((r) => isWithin(r, p))) this.touchPending.add(p);
    if (!this.touchPending.size) return;
    clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => void this.flushTouches(), 300);
  }

  private async flushTouches(): Promise<void> {
    const paths = [...this.touchPending];
    this.touchPending.clear();
    const roots = this.roots();
    for (const p of paths) {
      const root = roots.find((r) => isWithin(r, p));
      if (!root || p === root) continue;
      const st = await fsp.lstat(p).catch(() => undefined);
      if (!st) {
        const prefix = p + path.sep;
        this.db.run('DELETE FROM index_entries WHERE path = ? OR substr(path, 1, ?) = ?', [p, prefix.length, prefix]);
        continue;
      }
      if (this.excluded(path.basename(p))) continue;
      if (st.isDirectory()) {
        // A new or moved-in folder: rescan the root to pick up its contents.
        this.enqueue(root);
        continue;
      }
      const kind = st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other';
      const ext = extOf(path.basename(p));
      const content = this.contentEnabled && kind === 'file' && isTextLike(ext) ? await readSmallText(p) : null;
      this.db.run(
        `INSERT INTO index_entries(path, root, parent, name, name_lc, ext, kind, size, mtime_ms, ctime_ms, content) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime_ms=excluded.mtime_ms, content=excluded.content, kind=excluded.kind`,
        [p, root, path.dirname(p), path.basename(p), path.basename(p).toLowerCase(), ext, kind, kind === 'file' ? st.size : null, st.mtimeMs, st.birthtimeMs > 0 ? st.birthtimeMs : null, content],
      );
    }
    this.emitStatus();
  }

  private watchRoot(root: string): void {
    if (this.watchers.has(root)) return;
    const recursive = process.platform === 'darwin' || process.platform === 'win32';
    if (!recursive) {
      const tw = new TreeWatcher(root, (p) => this.touch([p]), { maxDirs: this.maxWatchedFolders, exclude: (n) => this.excluded(n) });
      this.watchers.set(root, tw);
      this.treeWatchers.set(root, tw);
      void tw.start().then(() => this.emitStatus());
      return;
    }
    try {
      const w = fs.watch(root, { recursive, persistent: false }, (_ev, file) => {
        if (file) this.touch([path.join(root, file.toString())]);
      });
      w.on('error', () => {
        w.close();
        this.watchers.delete(root);
      });
      this.watchers.set(root, w);
    } catch {
      /* root unavailable; periodic reconciliation will report it */
    }
  }

  status(): IndexStatus {
    const roots = this.db.all<{ path: string; last_full_scan_ms: number | null; last_error: string | null }>('SELECT path, last_full_scan_ms, last_error FROM index_roots ORDER BY path');
    return {
      state: this.state,
      roots: roots.map((r) => ({
        path: r.path,
        entries: this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM index_entries WHERE root = ?', [r.path])?.n ?? 0,
        lastFullScanMs: r.last_full_scan_ms,
        lastError: r.last_error,
        available: fs.existsSync(r.path),
      })),
      currentRoot: this.currentRoot,
      scanned: this.scanned,
      contentEnabled: this.contentEnabled,
      exclusions: this.exclusionSources,
      watchMode: process.platform === 'darwin' || process.platform === 'win32' ? 'recursive' : 'per-folder',
      watchedFolders: this.treeWatchers.size ? [...this.treeWatchers.values()].reduce((a, w) => a + w.watchedCount, 0) : undefined,
      watchCapped: [...this.treeWatchers.values()].some((w) => w.capped),
    };
  }

  private statusTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private emitStatus(): void {
    if (this.statusTimer || this.stopped) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.emit('status', this.status());
    }, 250);
  }
}
