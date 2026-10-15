import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppDatabase } from '../store/Database';
import { makeError } from '../../shared/errors';
import { exists } from '../fs/FileSystemService';
import { uniqueName } from '../fs/paths';
import { sha256 } from './analysis';

/**
 * Local version history.
 *
 * Two kinds, clearly distinguished in the UI:
 *  - 'file-copy': a full copy of one file in application storage. Restorable.
 *  - 'folder-manifest': names, sizes, times and SHA-256 of a folder's files.
 *    Metadata only — it shows what changed but CANNOT restore content.
 *
 * Storage is capped (default 5 GB total, 1 GB per file); a snapshot that would
 * exceed the cap is refused rather than silently evicting older history.
 */

export interface Snapshot {
  id: string;
  path: string;
  kind: 'file-copy' | 'folder-manifest';
  createdMs: number;
  bytes: number;
  restorable: boolean;
  manifestCount?: number;
}

export interface ManifestEntry { rel: string; size: number; mtimeMs: number; sha256?: string }

export interface SnapshotDiff { added: string[]; removed: string[]; changed: string[]; unchanged: number; unverified: string[] }

export class SnapshotStore {
  maxTotalBytes = 5 * 1024 ** 3;
  maxFileBytes = 1024 ** 3;

  constructor(private readonly db: AppDatabase, private readonly dir: string) {}

  list(forPath?: string): Snapshot[] {
    const rows = forPath
      ? this.db.all<Record<string, unknown>>('SELECT * FROM snapshots WHERE path = ? ORDER BY created_ms DESC', [forPath])
      : this.db.all<Record<string, unknown>>('SELECT * FROM snapshots ORDER BY created_ms DESC LIMIT 500');
    return rows.map((r) => {
      const kind = r.kind as Snapshot['kind'];
      const manifest = kind === 'folder-manifest' ? (JSON.parse(String(r.manifest)) as ManifestEntry[]) : undefined;
      return { id: String(r.id), path: String(r.path), kind, createdMs: Number(r.created_ms), bytes: Number(r.bytes), restorable: kind === 'file-copy', manifestCount: manifest?.length };
    });
  }

  usedBytes(): number {
    return this.db.get<{ n: number | null }>("SELECT SUM(bytes) AS n FROM snapshots WHERE kind = 'file-copy'")?.n ?? 0;
  }

  async create(p: string, signal: AbortSignal = new AbortController().signal): Promise<Snapshot> {
    const st = await fsp.lstat(p).catch(() => undefined);
    if (!st) throw makeError('not_found', 'snapshot.create', { target: p });
    const id = crypto.randomUUID();
    if (st.isFile()) {
      if (st.size > this.maxFileBytes) throw makeError('unsupported', 'snapshot.create', { message: `Files over ${Math.round(this.maxFileBytes / 1024 ** 2)} MB are not snapshotted.` });
      if (this.usedBytes() + st.size > this.maxTotalBytes) throw makeError('no_space', 'snapshot.create', { message: 'Snapshot storage is full. Delete older snapshots first.' });
      await fsp.mkdir(path.join(this.dir, id), { recursive: true });
      const dest = path.join(this.dir, id, path.basename(p));
      await fsp.copyFile(p, dest, fs.constants.COPYFILE_EXCL);
      const [a, b] = await Promise.all([sha256(p), sha256(dest)]);
      if (a !== b) {
        await fsp.rm(path.join(this.dir, id), { recursive: true, force: true });
        throw makeError('io', 'snapshot.create', { message: 'The file changed while it was being saved. Try again.' });
      }
      const manifest: ManifestEntry[] = [{ rel: path.basename(p), size: st.size, mtimeMs: st.mtimeMs, sha256: a }];
      this.db.run('INSERT INTO snapshots(id, path, kind, created_ms, storage_path, manifest, bytes) VALUES(?, ?, ?, ?, ?, ?, ?)', [id, p, 'file-copy', Date.now(), dest, JSON.stringify(manifest), st.size]);
    } else if (st.isDirectory()) {
      const manifest = await buildManifest(p, signal);
      this.db.run('INSERT INTO snapshots(id, path, kind, created_ms, storage_path, manifest, bytes) VALUES(?, ?, ?, ?, NULL, ?, 0)', [id, p, 'folder-manifest', Date.now(), JSON.stringify(manifest)]);
    } else throw makeError('unsupported', 'snapshot.create', { target: p });
    return this.list(p).find((s) => s.id === id)!;
  }

  /** Restore a file-copy snapshot to a destination folder, never overwriting. */
  async restore(id: string, destinationDir: string): Promise<string> {
    const row = this.db.get<{ kind: string; storage_path: string | null; path: string; manifest: string }>('SELECT kind, storage_path, path, manifest FROM snapshots WHERE id = ?', [id]);
    if (!row) throw makeError('not_found', 'snapshot.restore', { message: 'Snapshot not found.' });
    if (row.kind !== 'file-copy' || !row.storage_path) {
      throw makeError('unsupported', 'snapshot.restore', { message: 'This is a metadata-only snapshot. It records what the folder contained but cannot restore file contents.' });
    }
    const manifest = JSON.parse(row.manifest) as ManifestEntry[];
    const stored = await sha256(row.storage_path).catch(() => undefined);
    if (stored !== manifest[0]?.sha256) throw makeError('io', 'snapshot.restore', { message: 'The stored snapshot is damaged or missing and cannot be restored.' });
    let name = path.basename(row.path);
    if (await exists(path.join(destinationDir, name))) name = await uniqueName(destinationDir, name, exists);
    const dest = path.join(destinationDir, name);
    await fsp.copyFile(row.storage_path, dest, fs.constants.COPYFILE_EXCL);
    return dest;
  }

  /** The stored bytes of a file-copy snapshot, checked against the SHA-256 recorded when it was made. */
  async readCopy(id: string): Promise<{ path: string; bytes: Buffer; sha256: string }> {
    const row = this.db.get<{ kind: string; storage_path: string | null; path: string; manifest: string }>('SELECT kind, storage_path, path, manifest FROM snapshots WHERE id = ?', [id]);
    if (!row) throw makeError('not_found', 'snapshot.read', { message: 'The snapshot no longer exists.' });
    if (row.kind !== 'file-copy' || !row.storage_path) throw makeError('unsupported', 'snapshot.read', { message: 'This snapshot holds no file contents.' });
    const want = (JSON.parse(row.manifest) as ManifestEntry[])[0]?.sha256;
    const bytes = await fsp.readFile(row.storage_path).catch(() => undefined);
    if (!bytes || !want || crypto.createHash('sha256').update(bytes).digest('hex') !== want) throw makeError('io', 'snapshot.read', { message: 'The stored snapshot is damaged or missing and cannot be restored.' });
    return { path: row.path, bytes, sha256: want };
  }

  async delete(id: string): Promise<void> {
    await fsp.rm(path.join(this.dir, id), { recursive: true, force: true });
    this.db.run('DELETE FROM snapshots WHERE id = ?', [id]);
  }

  /** Compare a snapshot with the current state on disk. */
  async diff(id: string, signal: AbortSignal = new AbortController().signal): Promise<SnapshotDiff> {
    const row = this.db.get<{ path: string; manifest: string; kind: string }>('SELECT path, manifest, kind FROM snapshots WHERE id = ?', [id]);
    if (!row) throw makeError('not_found', 'snapshot.diff');
    const then = new Map((JSON.parse(row.manifest) as ManifestEntry[]).map((m) => [m.rel, m]));
    const st = await fsp.lstat(row.path).catch(() => undefined);
    let now: ManifestEntry[] = [];
    if (row.kind === 'file-copy') {
      if (st?.isFile()) now = [{ rel: path.basename(row.path), size: st.size, mtimeMs: st.mtimeMs, sha256: await sha256(row.path) }];
    } else if (st?.isDirectory()) now = await buildManifest(row.path, signal);
    const out: SnapshotDiff = { added: [], removed: [], changed: [], unchanged: 0, unverified: [] };
    const nowMap = new Map(now.map((m) => [m.rel, m]));
    for (const [rel, m] of then) {
      const n = nowMap.get(rel);
      if (!n) out.removed.push(rel);
      else if (m.sha256 && n.sha256) {
        if (m.sha256 === n.sha256) out.unchanged++;
        else out.changed.push(rel);
      }
      else if (m.size !== n.size || Math.abs(m.mtimeMs - n.mtimeMs) > 1) out.changed.push(rel);
      else {
        out.unchanged++;
        out.unverified.push(rel);
      }
    }
    for (const rel of nowMap.keys()) if (!then.has(rel)) out.added.push(rel);
    return out;
  }
}

/** Hash files up to 64 MB; larger files are recorded by size and time only. */
export async function buildManifest(root: string, signal: AbortSignal): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  const stack = [''];
  while (stack.length) {
    if (signal.aborted) throw makeError('cancelled', 'snapshot.manifest');
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    for (const d of await fsp.readdir(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const p = path.join(abs, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) stack.push(r);
      else if (d.isFile()) {
        const st = await fsp.stat(p);
        out.push({ rel: r, size: st.size, mtimeMs: st.mtimeMs, sha256: st.size <= 64 * 1024 * 1024 ? await sha256(p) : undefined });
      }
    }
    if (out.length > 200_000) throw makeError('unsupported', 'snapshot.manifest', { message: 'Folders with more than 200,000 files are not snapshotted.' });
  }
  return out;
}
