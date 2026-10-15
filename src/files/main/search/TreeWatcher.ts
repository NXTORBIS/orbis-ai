import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Recursive change notifications built from one non-recursive watcher per
 * folder, for platforms whose native watcher is not recursive (Linux inotify).
 * Links are never followed. The number of watched folders is capped so a huge
 * tree cannot exhaust the system's watch limit; anything beyond the cap is
 * still covered by the indexer's periodic reconciliation scans, and the cap is
 * reported rather than hidden.
 */
export class TreeWatcher {
  private watchers = new Map<string, fs.FSWatcher>();
  private closed = false;
  /** True when the cap was reached and some folders are not watched. */
  capped = false;

  constructor(
    private readonly root: string,
    /** `event`: 'rename' when an entry appeared, disappeared or was renamed; 'change' when its contents changed. */
    private readonly onChange: (p: string, event?: 'rename' | 'change') => void,
    private readonly opts: { maxDirs: number; exclude?: (name: string) => boolean } = { maxDirs: 4000 },
  ) {}

  get watchedCount(): number {
    return this.watchers.size;
  }

  async start(): Promise<void> {
    const queue = [this.root];
    while (queue.length && !this.closed) {
      const dir = queue.shift()!;
      if (!this.watch(dir)) break;
      for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (d.isDirectory() && !this.opts.exclude?.(d.name)) queue.push(path.join(dir, d.name));
      }
    }
    if (queue.length) this.capped = true;
  }

  private watch(dir: string): boolean {
    if (this.watchers.has(dir)) return true;
    if (this.watchers.size >= this.opts.maxDirs) {
      this.capped = true;
      return false;
    }
    try {
      const w = fs.watch(dir, { persistent: false }, (ev, file) => {
        if (!file) {
          this.onChange(dir);
          return;
        }
        const p = path.join(dir, file.toString());
        this.onChange(p, ev === 'change' ? 'change' : 'rename');
        // A folder that appeared (created or moved in) gets its own watcher.
        if (ev === 'rename') {
          void fsp.lstat(p).then((st) => {
            if (st.isDirectory() && !this.closed && !this.opts.exclude?.(path.basename(p))) void this.addTree(p);
          }, () => this.forget(p));
        }
      });
      w.on('error', () => this.forget(dir));
      this.watchers.set(dir, w);
      return true;
    } catch {
      return true; // unreadable folder: skip it, keep going
    }
  }

  private async addTree(dir: string): Promise<void> {
    const queue = [dir];
    while (queue.length && !this.closed) {
      const d = queue.shift()!;
      if (!this.watch(d)) return;
      for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && !this.opts.exclude?.(e.name)) queue.push(path.join(d, e.name));
    }
  }

  /** Stop watching a folder (and everything below it) that no longer exists. */
  private forget(p: string): void {
    const prefix = p + path.sep;
    for (const [dir, w] of this.watchers) {
      if (dir === p || dir.startsWith(prefix)) {
        w.close();
        this.watchers.delete(dir);
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
