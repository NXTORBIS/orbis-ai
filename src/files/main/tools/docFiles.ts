import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { OperationRecord } from '../../shared/operations';
import type { ExternalRunner, RunnerHelpers } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { uniqueName } from '../fs/paths';
import type { SnapshotStore } from './snapshots';

/**
 * File writing shared by the document tools (PDF tools, find & replace, text
 * fixes, restoring from snapshots). Originals are never written in place:
 * new content goes to a temporary sibling, is flushed and read back, the
 * original is checked to be unchanged, and only then is the temporary file
 * renamed over it (atomic on the same file system). New files are committed
 * with link(), which fails rather than overwrite anything that appeared.
 */

export const PART_PREFIX = '.orbis-part-';

export const sha256Of = (b: Uint8Array): string => crypto.createHash('sha256').update(b).digest('hex');

async function writeSynced(p: string, data: Uint8Array, mode: number): Promise<void> {
  const fh = await fsp.open(p, 'wx', mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Test seam: runs right before the temporary file is renamed over the original (a throw there must leave the original intact). */
export interface ReplaceHooks { beforeRename?: (tmp: string) => Promise<void> | void }

/**
 * Replace a regular file's contents atomically. `expectedSha256` is the hash
 * the caller based the new content on: if the file no longer has it (another
 * program changed it), nothing is written. Permissions are kept.
 */
export async function replaceFileAtomic(target: string, data: Uint8Array, expectedSha256: string, helpers: Pick<RunnerHelpers, 'temp' | 'committed'> | undefined, op: string, hooks?: ReplaceHooks): Promise<{ sha256: string }> {
  const st = await fsp.lstat(target).catch((err) => {
    throw new OrbisError(toOrbisError(err, op, target, 'no'));
  });
  if (!st.isFile()) throw makeError('unsupported', op, { target, message: 'Only regular files are changed (not links or folders).' });
  const tmp = path.join(path.dirname(target), `${PART_PREFIX}${crypto.randomUUID()}`);
  helpers?.temp(tmp);
  try {
    await writeSynced(tmp, data, st.mode & 0o7777);
    await fsp.chmod(tmp, st.mode & 0o7777).catch(() => undefined);
    const back = await fsp.readFile(tmp);
    if (!back.equals(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) throw makeError('io', op, { target, message: 'The new content could not be verified after writing. The original is unchanged.' });
    // Re-check the original right before replacing it.
    const now = await fsp.lstat(target);
    if (!now.isFile() || now.size !== st.size || now.mtimeMs !== st.mtimeMs || sha256Of(await fsp.readFile(target)) !== expectedSha256) {
      throw makeError('busy', op, { target, message: 'The file changed while the new version was being prepared. Nothing was replaced.', retryable: true });
    }
    await hooks?.beforeRename?.(tmp);
    await fsp.rename(tmp, target);
    helpers?.committed(tmp);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    helpers?.committed(tmp);
    throw err;
  }
  const final = sha256Of(await fsp.readFile(target));
  const want = sha256Of(data);
  if (final !== want) throw makeError('io', op, { target, message: 'The file did not verify after it was replaced.', dataChanged: 'yes' });
  return { sha256: final };
}

/**
 * Write a new file into `dir` under `name`, or "name (2)…" when that is taken
 * ("keep both"). `verify` checks the bytes read back from the temporary file.
 * Returns the path written.
 */
export async function writeNewFile(dir: string, name: string, data: Uint8Array, helpers: Pick<RunnerHelpers, 'temp' | 'committed'>, op: string, verify?: (written: Buffer) => Promise<void>): Promise<string> {
  const tmp = path.join(dir, `${PART_PREFIX}${crypto.randomUUID()}`);
  helpers.temp(tmp);
  try {
    await writeSynced(tmp, data, 0o666); // the process umask applies, as for any new file
    const back = await fsp.readFile(tmp);
    if (!back.equals(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) throw makeError('io', op, { message: 'The new file could not be verified after writing.' });
    await verify?.(back);
    for (let attempt = 0; attempt < 8; attempt++) {
      const target = path.join(dir, (await exists(path.join(dir, name))) ? await uniqueName(dir, name, exists) : name);
      try {
        await fsp.link(tmp, target);
        await fsp.unlink(tmp);
        helpers.committed(tmp);
        return target;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'EEXIST') continue; // something appeared under that name meanwhile: pick another
        if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EXDEV') {
          // No hard links here (FAT, some network shares): check, then rename.
          if (await exists(target)) continue;
          await fsp.rename(tmp, target);
          helpers.committed(tmp);
          return target;
        }
        throw err;
      }
    }
    throw makeError('already_exists', op, { message: 'Could not find a free name for the new file.' });
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    helpers.committed(tmp);
    throw err;
  }
}

/** An in-place edit that can be undone from its snapshot. */
export interface SnapshotUndoItem { path: string; snapshotId: string; sha256After: string }

/**
 * Restore files edited in place (find & replace, text fixes) from the snapshots
 * taken before the edit. A file that changed again after the edit is not
 * touched (its snapshot stays available in Properties → Snapshots).
 */
export function makeSnapshotRestoreRunner(deps: { snapshots: SnapshotStore; markRunning: (rec: OperationRecord) => void; onChanged: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const items = ((req.params as { items?: SnapshotUndoItem[] } | undefined)?.items ?? []).filter((i) => rec.sources.includes(i.path));
    rec.progress = { totalItems: items.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    for (const it of items) {
      await ctx.gate();
      try {
        const cur = await fsp.readFile(it.path).catch((err) => {
          throw new OrbisError({ ...toOrbisError(err, 'snapshot.restore', it.path, 'no'), message: 'The file is no longer there, so it was not restored. Its snapshot is kept (Properties → Snapshots).' });
        });
        if (sha256Of(cur) !== it.sha256After) throw makeError('busy', 'snapshot.restore', { target: it.path, message: 'The file was changed again after the edit, so it was not restored. Its earlier version is kept as a snapshot (Properties → Snapshots).' });
        const copy = await deps.snapshots.readCopy(it.snapshotId);
        await replaceFileAtomic(it.path, copy.bytes, it.sha256After, helpers, 'snapshot.restore');
        deps.onChanged(it.path);
        rec.results.push({ source: it.path, destination: it.path, status: 'done' });
      } catch (err) {
        const shape = toOrbisError(err, 'snapshot.restore', it.path, 'no');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: it.path, status: 'failed', error: shape });
      }
      helpers.tick(0, 1, path.basename(it.path));
    }
    rec.undo = { kind: 'none', reason: 'This restored the earlier versions; run the edit again to redo it.' };
  };
}
