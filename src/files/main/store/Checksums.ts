import type { PauseGate } from '../jobs/PauseGate';
import fsp from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { AppDatabase } from './Database';
import { hashFile } from '../fs/FileSystemService';

/**
 * Hashes a file (fs:hash) and, for SHA-256, records the result when the file
 * kept the same size and modification time from before the read to after it.
 */
export async function hashAndRecord(
  store: ChecksumStore,
  p: string,
  algorithm: 'sha256' | 'sha1' | 'md5' | 'sha512',
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  gate?: PauseGate,
): Promise<{ algorithm: string; digest: string; bytes: number }> {
  const before = await fsp.stat(p).catch(() => undefined);
  const r = await hashFile(p, algorithm, onProgress, signal, gate);
  const after = await fsp.stat(p).catch(() => undefined);
  if (algorithm === 'sha256' && before && after && before.size === after.size && before.mtimeMs === after.mtimeMs && r.bytes === after.size) {
    store.put({ path: p, size: after.size, mtimeMs: after.mtimeMs, sha256: r.digest });
  }
  return r;
}

export interface StoredChecksum {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  computedMs: number;
}

/**
 * SHA-256 checksums calculated by Orbis Files, kept across restarts.
 *
 * A stored value belongs to the file as it was when it was read: the same
 * path, size and modification time. It is returned only while all three still
 * match on disk; the row of a file seen with a different size or time is
 * deleted instead of shown. The table is capped (oldest calculations are
 * removed first).
 */
export class ChecksumStore {
  readonly maxRows: number;
  private readonly stat: (p: string) => Promise<Pick<Stats, 'size' | 'mtimeMs' | 'isFile'>>;
  private readonly now: () => number;
  private sinceCount = 0;

  constructor(
    private readonly db: AppDatabase,
    opts: { maxRows?: number; stat?: (p: string) => Promise<Pick<Stats, 'size' | 'mtimeMs' | 'isFile'>>; now?: () => number } = {},
  ) {
    this.maxRows = opts.maxRows ?? 200_000;
    this.stat = opts.stat ?? ((p) => fsp.stat(p));
    this.now = opts.now ?? Date.now;
  }

  put(rec: { path: string; size: number; mtimeMs: number; sha256: string }): void {
    if (!/^[0-9a-f]{64}$/.test(rec.sha256)) throw new Error('Not a SHA-256 digest');
    this.db.run(
      'INSERT INTO checksums(path, size, mtime_ms, sha256, computed_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, sha256 = excluded.sha256, computed_ms = excluded.computed_ms',
      [rec.path, rec.size, rec.mtimeMs, rec.sha256, this.now()],
    );
    // Counting is cheap but not free; check the cap every few writes, and always near it.
    if (++this.sinceCount >= 50 || this.maxRows < 1000) {
      this.sinceCount = 0;
      this.prune();
    }
  }

  /** Removes the oldest rows beyond the cap. Returns how many were removed. */
  prune(): number {
    const n = this.count();
    if (n <= this.maxRows) return 0;
    const extra = n - this.maxRows;
    this.db.run('DELETE FROM checksums WHERE path IN (SELECT path FROM checksums ORDER BY computed_ms ASC, path ASC LIMIT ?)', [extra]);
    return extra;
  }

  count(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM checksums')?.n ?? 0;
  }

  /** Stored checksums for these paths whose files still have the recorded size and modification time. */
  async get(paths: string[]): Promise<StoredChecksum[]> {
    const rows: Array<{ path: string; size: number; mtime_ms: number; sha256: string; computed_ms: number }> = [];
    const unique = [...new Set(paths)];
    for (let i = 0; i < unique.length; i += 500) {
      const part = unique.slice(i, i + 500);
      rows.push(...this.db.all<(typeof rows)[number]>(`SELECT path, size, mtime_ms, sha256, computed_ms FROM checksums WHERE path IN (${part.map(() => '?').join(',')})`, part));
    }
    const out: StoredChecksum[] = [];
    const stale: string[] = [];
    await Promise.all(rows.map(async (r) => {
      const st = await this.stat(r.path).catch(() => undefined);
      // Not reachable right now (e.g. a disconnected drive): not shown, but kept until it is seen changed or pruned.
      if (!st) return;
      if (st.isFile() && st.size === r.size && st.mtimeMs === r.mtime_ms) out.push({ path: r.path, size: r.size, mtimeMs: r.mtime_ms, sha256: r.sha256, computedMs: r.computed_ms });
      else stale.push(r.path);
    }));
    for (const p of stale) this.db.run('DELETE FROM checksums WHERE path = ?', [p]);
    return out;
  }
}
