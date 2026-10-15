import { createStore } from './store';
import { call, runJob } from '../api';
import { toast, toastError } from './app';
import type { FileEntry } from '../../shared/model';

/**
 * Checksums calculated for files (context menu → Calculate checksum, or the
 * details panel). SHA-256 results are also stored by the main process, keyed
 * by path, size and modification time, and loaded again for the files on
 * screen. The Checksum column shows only values that were really calculated
 * for the file as it is now (same size and modification time); anything else
 * is shown as "not calculated", never guessed.
 */
export interface ChecksumRecord { algorithm: 'sha256' | 'sha1' | 'md5' | 'sha512'; digest: string; size?: number; modifiedMs?: number; computedMs: number }

export const checksums = createStore<{ byPath: Record<string, ChecksumRecord>; running: Record<string, true> }>({ byPath: {}, running: {} });

export function checksumFor(e: Pick<FileEntry, 'path' | 'size' | 'modifiedMs'>, byPath = checksums.get().byPath): ChecksumRecord | undefined {
  const r = byPath[e.path];
  return r && r.size === e.size && r.modifiedMs === e.modifiedMs ? r : undefined;
}

export function recordChecksum(e: Pick<FileEntry, 'path' | 'size' | 'modifiedMs'>, algorithm: ChecksumRecord['algorithm'], digest: string): void {
  checksums.set((s) => ({ byPath: { ...s.byPath, [e.path]: { algorithm, digest, size: e.size, modifiedMs: e.modifiedMs, computedMs: Date.now() } } }));
}

interface StoredChecksum { path: string; size: number; mtimeMs: number; sha256: string; computedMs: number }

/** Most files whose stored checksums are looked up for one folder. */
export const STORED_LOOKUP_LIMIT = 20000;

/**
 * Loads stored SHA-256 checksums for these files. The main process returns only
 * values whose file still has the recorded size and modification time; they are
 * kept here only if they also match the entry being shown.
 */
export async function loadStoredChecksums(entries: Array<Pick<FileEntry, 'path' | 'size' | 'modifiedMs' | 'kind'>>, signal?: { cancelled: boolean }): Promise<void> {
  const files = entries.filter((e) => e.kind === 'file' && !checksumFor(e)).slice(0, STORED_LOOKUP_LIMIT);
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (let i = 0; i < files.length && !signal?.cancelled; i += 1000) {
    const found = await call<StoredChecksum[]>('checksum:get', { paths: files.slice(i, i + 1000).map((f) => f.path) }).catch(() => [] as StoredChecksum[]);
    const fresh = found.filter((r) => {
      const e = byPath.get(r.path);
      return e && e.size === r.size && e.modifiedMs === r.mtimeMs;
    });
    if (!fresh.length || signal?.cancelled) continue;
    checksums.set((s) => {
      const next = { ...s.byPath };
      for (const r of fresh) if (!checksumFor({ path: r.path, size: r.size, modifiedMs: r.mtimeMs }, next)) next[r.path] = { algorithm: 'sha256', digest: r.sha256, size: r.size, modifiedMs: r.mtimeMs, computedMs: r.computedMs };
      return { byPath: next };
    });
  }
}

const MAX_BATCH = 200;

/** Calculate SHA-256 for files one after another as a cancellable background task. */
export async function computeChecksums(files: FileEntry[]): Promise<void> {
  const list = files.filter((f) => f.kind === 'file').slice(0, MAX_BATCH);
  if (files.length > MAX_BATCH) toast({ level: 'info', title: `Checksums are calculated for the first ${MAX_BATCH} files`, detail: 'Select fewer files to calculate the rest.' });
  // Files already calculated (in an earlier session too) are not read again.
  await loadStoredChecksums(list);
  let done = 0;
  const known = list.filter((f) => checksumFor(f)).length;
  if (known === list.length && known) toast({ level: 'info', title: known === 1 ? 'This checksum was already calculated' : `These ${known} checksums were already calculated`, detail: 'The files have not changed since; the stored values are shown in the Checksum column and the details panel.' });
  for (const f of list) {
    if (checksumFor(f) || checksums.get().running[f.path]) continue;
    checksums.set((s) => ({ running: { ...s.running, [f.path]: true } }));
    try {
      const j = runJob<{ digest: string }>((jobId) => call('fs:hash', { path: f.path, algorithm: 'sha256', jobId }), undefined, `Checksum of ${f.name}`);
      const r = await j.promise;
      if (r.cancelled) break;
      if (r.value?.digest) {
        recordChecksum(f, 'sha256', r.value.digest);
        done++;
      }
    } catch (err) {
      toastError(err, `Checksum of ${f.name} could not be calculated`);
    } finally {
      checksums.set((s) => {
        const running = { ...s.running };
        delete running[f.path];
        return { running };
      });
    }
  }
  if (done) toast({ level: 'success', title: `Calculated ${done} checksum${done === 1 ? '' : 's'}`, detail: 'Shown in the Checksum column (Details view) and the details panel.' });
}
