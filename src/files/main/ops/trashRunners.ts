import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import type { ConflictInfo, OperationRecord } from '../../shared/operations';
import type { ExternalRunner } from './OperationManager';
import type { ResolvedTrashItem, TrashStore } from '../fs/trash';
import { uniqueName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';

/**
 * Operation runners for the system Trash: 'trash-restore' (to the original
 * location, or to `destination` for "Restore to…") and 'trash-delete'
 * (permanent deletion, also used by Empty Trash). Sources are paths inside the
 * Trash and are re-validated against the Trash on disk for every item.
 */

const RestoreParams = z
  .object({
    /** For undo: the original path each source is expected to have, so a reused Trash name is never restored by mistake. */
    expected: z.array(z.object({ source: z.string().max(32767), original: z.string().max(32767) })).max(1_000_000).optional(),
  })
  .passthrough();

function kindOf(st: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }): ConflictInfo['sourceKind'] {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

export function makeTrashRunners(store: TrashStore, markRunning: (rec: OperationRecord) => void): { restore: ExternalRunner; remove: ExternalRunner } {
  const restore: ExternalRunner = async (rec, req, ctx, helpers) => {
    const params = RestoreParams.safeParse(req.params ?? {});
    if (!params.success) throw makeError('validation', 'trash.restore', { message: 'The restore request is not valid.' });
    const expected = new Map((params.data.expected ?? []).map((e) => [path.resolve(e.source), path.resolve(e.original)]));
    const restoreTo = rec.destination;
    if (restoreTo) {
      const st = await fsp.stat(restoreTo).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'trash.restore', { message: 'The folder to restore into does not exist.', target: restoreTo });
    }
    rec.progress = { totalItems: rec.sources.length, completedItems: 0, completedBytes: 0 };
    markRunning(rec);
    for (const source of rec.sources) {
      await ctx.gate();
      let target: string | undefined;
      try {
        const item: ResolvedTrashItem = await store.resolve(source);
        const want = expected.get(item.trashedPath);
        if (want && item.originalPath !== want) {
          throw makeError('validation', 'trash.restore', { message: 'This Trash entry now belongs to a different item, so it was not restored.', target: source });
        }
        if (restoreTo) target = path.join(restoreTo, path.basename(item.originalPath ?? item.name));
        else if (item.originalPath) target = item.originalPath;
        else throw makeError('unavailable', 'trash.restore', { message: `${item.problem ?? 'Its original location is unknown.'} Use Restore to… to choose a folder.`, target: source });
        const parent = path.dirname(target);
        if (await exists(target)) {
          const dst = await fsp.lstat(target);
          const action = await helpers.ask({
            source,
            destination: target,
            sourceKind: kindOf(item.stat),
            destinationKind: kindOf(dst),
            sourceSize: item.stat.isFile() ? item.stat.size : undefined,
            destinationSize: dst.isFile() ? dst.size : undefined,
            sourceModifiedMs: item.stat.mtimeMs,
            destinationModifiedMs: dst.mtimeMs,
            suggestedName: await uniqueName(parent, path.basename(target), exists),
            remaining: rec.sources.length - rec.results.length,
            allowed: ['keep-both', 'skip'],
          });
          if (action === 'keep-both') target = path.join(parent, await uniqueName(parent, path.basename(target), exists));
          else {
            // Skip — and Replace or Merge, which restoring never does: the existing item is left untouched.
            rec.results.push({ source, destination: target, status: 'skipped' });
            helpers.tick(0, 1, item.name);
            continue;
          }
        }
        await store.restore(item, target);
        rec.results.push({ source, destination: target, status: 'done' });
        helpers.tick(item.stat.isFile() ? item.stat.size : 0, 1, item.name);
      } catch (err) {
        const shape = toOrbisError(err, 'trash.restore', source, 'no');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source, destination: target, status: 'failed', error: shape });
        helpers.tick(0, 1);
      }
    }
  };

  const remove: ExternalRunner = async (rec, _req, ctx, helpers) => {
    rec.progress = { totalItems: rec.sources.length, completedItems: 0, completedBytes: 0 };
    markRunning(rec);
    for (const source of rec.sources) {
      await ctx.gate();
      try {
        const item = await store.resolve(source);
        await store.deletePermanently(item);
        rec.results.push({ source, status: 'done' });
        helpers.tick(item.stat.isFile() ? item.stat.size : 0, 1, item.name);
      } catch (err) {
        const shape = toOrbisError(err, 'trash.delete', source, 'unknown');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source, status: 'failed', error: shape });
        helpers.tick(0, 1);
      }
    }
  };

  return { restore, remove };
}
