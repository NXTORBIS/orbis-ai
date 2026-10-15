import crypto from 'node:crypto';
import type { AppDatabase } from '../store/Database';
import { makeError } from '../../shared/errors';
import { isSafeRel, SyncModeSchema, SyncOptionsSchema, type SyncMode, type SyncOptions, type SyncPair, type SyncRunSummary } from '../../shared/sync';
import type { Baseline, BaselineRow } from './engine';

/**
 * Saved sync pairs and two-way baselines (schema v7: sync_pairs,
 * sync_baselines, sync_baseline_info).
 *
 * A baseline belongs to an ordered pair of folders (their real paths), not to
 * a saved pair, so an unsaved two-way run and a saved pair for the same two
 * folders share it. Swapping left and right is a different pair.
 */

export function pairKey(left: string, right: string): string {
  return crypto.createHash('sha256').update(`${left}\0${right}`).digest('hex');
}

interface PairRow {
  id: string;
  name: string;
  left_path: string;
  right_path: string;
  mode: string;
  options: string;
  created_ms: number;
  updated_ms: number;
  last_run_ms: number | null;
  last_summary: string | null;
}

export class SyncStore {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  private toPair(r: PairRow): SyncPair {
    let options: SyncOptions;
    try {
      options = SyncOptionsSchema.parse(JSON.parse(r.options));
    } catch {
      options = SyncOptionsSchema.parse({});
    }
    const mode = SyncModeSchema.safeParse(r.mode);
    let lastSummary: SyncRunSummary | undefined;
    try {
      lastSummary = r.last_summary ? (JSON.parse(r.last_summary) as SyncRunSummary) : undefined;
    } catch {
      lastSummary = undefined;
    }
    return {
      id: r.id, name: r.name, left: r.left_path, right: r.right_path, mode: mode.success ? mode.data : 'update', options,
      createdMs: r.created_ms, updatedMs: r.updated_ms, lastRunMs: r.last_run_ms ?? undefined, lastSummary,
    };
  }

  pairs(): SyncPair[] {
    return this.db.all<PairRow>('SELECT * FROM sync_pairs ORDER BY name COLLATE NOCASE, created_ms').map((r) => this.toPair(r));
  }

  pair(id: string): SyncPair | undefined {
    const r = this.db.get<PairRow>('SELECT * FROM sync_pairs WHERE id = ?', [id]);
    return r ? this.toPair(r) : undefined;
  }

  savePair(input: { id?: string; name: string; left: string; right: string; mode: SyncMode; options: SyncOptions }): SyncPair {
    const t = this.now();
    if (input.id) {
      const existing = this.pair(input.id);
      if (!existing) throw makeError('not_found', 'sync.savePair', { message: 'This sync pair no longer exists.' });
      this.db.run('UPDATE sync_pairs SET name = ?, left_path = ?, right_path = ?, mode = ?, options = ?, updated_ms = ? WHERE id = ?', [input.name, input.left, input.right, input.mode, JSON.stringify(input.options), t, input.id]);
      return this.pair(input.id)!;
    }
    const id = crypto.randomUUID();
    this.db.run('INSERT INTO sync_pairs(id, name, left_path, right_path, mode, options, created_ms, updated_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', [id, input.name, input.left, input.right, input.mode, JSON.stringify(input.options), t, t]);
    return this.pair(id)!;
  }

  deletePair(id: string): void {
    this.db.run('DELETE FROM sync_pairs WHERE id = ?', [id]);
  }

  recordRun(id: string, summary: SyncRunSummary): void {
    this.db.run('UPDATE sync_pairs SET last_run_ms = ?, last_summary = ? WHERE id = ?', [summary.finishedMs, JSON.stringify(summary), id]);
  }

  // ---------------- baselines

  baselineInfo(left: string, right: string): { entries: number; updatedMs: number } | undefined {
    const r = this.db.get<{ entries: number; updated_ms: number }>('SELECT entries, updated_ms FROM sync_baseline_info WHERE pair_key = ?', [pairKey(left, right)]);
    return r ? { entries: r.entries, updatedMs: r.updated_ms } : undefined;
  }

  baseline(left: string, right: string): Baseline | undefined {
    const key = pairKey(left, right);
    const meta = this.db.get<{ updated_ms: number }>('SELECT updated_ms FROM sync_baseline_info WHERE pair_key = ?', [key]);
    if (!meta) return undefined;
    const rows = this.db.all<{ rel: string; kind: string; size: number | null; left_mtime_ms: number; right_mtime_ms: number; sha256: string | null; link_target: string | null }>(
      'SELECT rel, kind, size, left_mtime_ms, right_mtime_ms, sha256, link_target FROM sync_baselines WHERE pair_key = ?',
      [key],
    );
    return {
      updatedMs: meta.updated_ms,
      rows: rows
        .filter((r) => r.kind === 'file' || r.kind === 'directory' || r.kind === 'symlink')
        .map((r) => ({
          rel: r.rel, kind: r.kind as BaselineRow['kind'], size: r.size ?? undefined, leftMtimeMs: r.left_mtime_ms, rightMtimeMs: r.right_mtime_ms,
          sha256: r.sha256 ?? undefined, linkTarget: r.link_target ?? undefined,
        })),
    };
  }

  /** Replace the whole baseline of a folder pair in one transaction. Rows with unsafe paths are never stored. */
  saveBaseline(left: string, right: string, rows: BaselineRow[]): void {
    const key = pairKey(left, right);
    const safe = rows.filter((r) => isSafeRel(r.rel));
    this.db.tx(() => {
      this.db.run('DELETE FROM sync_baselines WHERE pair_key = ?', [key]);
      for (const r of safe) {
        this.db.run('INSERT INTO sync_baselines(pair_key, rel, kind, size, left_mtime_ms, right_mtime_ms, sha256, link_target) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', [
          key, r.rel, r.kind, r.size ?? null, r.leftMtimeMs, r.rightMtimeMs, r.sha256 ?? null, r.linkTarget ?? null,
        ]);
      }
      this.db.run(
        'INSERT INTO sync_baseline_info(pair_key, left_path, right_path, entries, updated_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(pair_key) DO UPDATE SET entries = excluded.entries, updated_ms = excluded.updated_ms',
        [key, left, right, safe.length, this.now()],
      );
    });
  }

  forgetBaseline(left: string, right: string): boolean {
    const key = pairKey(left, right);
    const had = !!this.baselineInfo(left, right);
    this.db.tx(() => {
      this.db.run('DELETE FROM sync_baselines WHERE pair_key = ?', [key]);
      this.db.run('DELETE FROM sync_baseline_info WHERE pair_key = ?', [key]);
    });
    return had;
  }
}
