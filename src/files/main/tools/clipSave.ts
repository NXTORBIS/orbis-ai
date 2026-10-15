import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError, OrbisError } from '../../shared/errors';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { uniqueName, validateName } from '../fs/paths';

/**
 * 'clip-save': write the image or text that was on the clipboard as a new
 * file. Started only by the main process (the data is read from the clipboard
 * there and travels in the in-memory request, never in the stored record); the
 * renderer cannot request this type. Written to a temporary sibling, fsynced,
 * checked and committed with link(), so nothing is replaced (a taken name asks
 * Keep both or Skip). Undo moves the new file to the Trash.
 */

const PART_PREFIX = '.orbis-part-';

export function validateClipSaveRequest(req: OperationRequest): void {
  const p = req.params as { name?: unknown; data?: unknown } | undefined;
  if (!p || typeof p.name !== 'string' || !Buffer.isBuffer(p.data)) throw makeError('validation', 'clip.save', { message: 'Nothing to save.' });
  const v = validateName(p.name);
  if (!v.valid) throw makeError('invalid_name', 'clip.save', { message: v.reason, target: p.name });
  if (!req.destination) throw makeError('validation', 'clip.save', { message: 'Choose a folder.' });
}

export function makeClipSaveRunner(deps: { markRunning: (rec: OperationRecord) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = req.params as { name: string; data?: Buffer };
    const data = params.data;
    if (!data) throw makeError('unavailable', 'clip.save', { message: 'The clipboard contents are no longer available. Copy them again and paste.' });
    const dir = rec.destination!;
    const st = await fsp.stat(dir).catch(() => undefined);
    if (!st?.isDirectory()) throw makeError('not_a_directory', 'clip.save', { target: dir, message: 'The folder does not exist.' });
    rec.progress = { totalItems: 1, totalBytes: data.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    let target = path.join(dir, params.name);
    if (await exists(target)) {
      const action = await helpers.ask({ source: params.name, destination: target, sourceKind: 'file', destinationKind: 'file', sourceSize: data.length, suggestedName: await uniqueName(dir, params.name, exists), remaining: 0, allowed: ['keep-both', 'skip'] });
      if (action !== 'keep-both') {
        rec.results.push({ source: target, destination: target, status: 'skipped' });
        return;
      }
      target = path.join(dir, await uniqueName(dir, params.name, exists));
    }
    await ctx.gate();
    const tmp = path.join(dir, `${PART_PREFIX}${crypto.randomUUID()}`);
    helpers.temp(tmp);
    const fh = await fsp.open(tmp, 'wx', 0o644);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    const back = await fsp.readFile(tmp);
    if (!back.equals(data)) throw makeError('io', 'clip.save', { message: 'The new file did not read back correctly. Nothing was saved.' });
    try {
      await fsp.link(tmp, target);
      await fsp.unlink(tmp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new OrbisError({ category: 'already_exists', operation: 'clip.save', message: `“${path.basename(target)}” appeared meanwhile and was not replaced.`, target, dataChanged: 'no', retryable: true });
      if (await exists(target)) throw makeError('already_exists', 'clip.save', { target });
      await fsp.rename(tmp, target);
    }
    helpers.committed(tmp);
    helpers.tick(data.length, 1, path.basename(target));
    // Free the data; a retry asks for a fresh paste.
    delete params.data;
    deps.onCreated?.(target);
    rec.results.push({ source: target, destination: target, status: 'done' });
    rec.undo = { kind: 'transfer', mode: 'copy', items: [{ source: target, destination: target }] };
  };
}
