import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import type { MediaMeta } from '../../shared/media';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import { dateFromFileName, DatesApplyItemSchema, DatesSpecSchema, exifDateMs, MAX_DATES_ITEMS, type DatesApplyItem, type DatesPlan, type DatesPlanItem, type DatesSpec } from '../../shared/powerTools';
import type { ExternalRunner } from '../ops/OperationManager';

/**
 * Set dates: change the modification and/or access time of files and folders
 * (optionally everything inside folders) to a chosen date and time, to now,
 * to the photo's EXIF date taken, or to a date written in the file name. The
 * preview lists every item with its current and new time; the 'set-dates'
 * operation records the previous times and its undo puts them back (only on
 * items whose modification time is still the one it set).
 *
 * Links are never followed and their own times are not changed (utimes would
 * change the target). Creation (birth) time is not changed: Linux has no
 * call for it, and Node.js offers none on macOS or Windows (see
 * docs/LIMITATIONS.md).
 */

/** Either a selection and a rule (planned in the operation, like the preview) or explicit times (the undo). */
export const SetDatesParamsSchema = z.union([
  z.object({ spec: DatesSpecSchema }),
  z.object({ items: z.array(DatesApplyItemSchema).min(1).max(MAX_DATES_ITEMS) }),
]);

/** Preview: every item (folders expanded when recursive) with its current and new times. */
export async function planDates(paths: string[], spec: DatesSpec, read: (p: string) => Promise<MediaMeta | undefined>, opts: { signal?: AbortSignal; wait?: () => Promise<void>; onProgress?: (done: number) => void; now?: number } = {}): Promise<DatesPlan> {
  const now = opts.now ?? Date.now();
  const items: DatesPlanItem[] = [];
  let truncated = false;
  const visit = async (p: string, top: boolean): Promise<void> => {
    if (opts.signal?.aborted) throw makeError('cancelled', 'dates.plan');
    if (items.length >= MAX_DATES_ITEMS) {
      truncated = true;
      return;
    }
    await opts.wait?.();
    const st = await fsp.lstat(p).catch(() => undefined);
    if (!st) {
      if (top) items.push({ path: p, name: path.basename(p), kind: 'other', mtimeMs: 0, atimeMs: 0, reason: 'It no longer exists.' });
      return;
    }
    const kind: DatesPlanItem['kind'] = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
    const item: DatesPlanItem = { path: p, name: path.basename(p), kind, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs };
    if (kind === 'symlink') item.reason = 'Links are left alone (their target is not changed either).';
    else if (kind === 'other') item.reason = 'Not a file or folder.';
    else {
      let ms: number | undefined;
      if (spec.mode === 'now') ms = now;
      else if (spec.mode === 'datetime') ms = spec.datetimeMs;
      else if (spec.mode === 'exif') {
        if (kind === 'directory') item.reason = 'Folders have no date taken.';
        else {
          const meta = await read(p).catch(() => undefined);
          ms = exifDateMs(meta?.exif?.takenAt);
          if (ms !== undefined) item.source = 'EXIF date taken';
          else item.reason = 'No date taken (EXIF) in this file.';
        }
      } else {
        const d = dateFromFileName(item.name);
        if (d) {
          ms = d.ms;
          item.source = `name: ${d.match}`;
        } else item.reason = 'No date found in the name.';
      }
      if (ms !== undefined) item.next = { mtimeMs: spec.modified ? ms : st.mtimeMs, atimeMs: spec.accessed ? ms : st.atimeMs };
    }
    items.push(item);
    opts.onProgress?.(items.length);
    if (kind === 'directory' && spec.recursive) {
      const names = (await fsp.readdir(p).catch(() => [] as string[])).sort((a, b) => a.localeCompare(b));
      for (const n of names) await visit(path.join(p, n), false);
    }
  };
  for (const p of paths) await visit(p, true);
  return { items, truncated };
}

/** fs.utimes takes seconds; milliseconds with fractions keep sub-millisecond precision. */
const secs = (ms: number) => ms / 1000;

export function validateDatesRequest(req: OperationRequest): void {
  const p = SetDatesParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'dates.run', { message: p.error.issues[0]?.message ?? 'The new dates are not valid.' });
  if ('items' in p.data && !p.data.items.every((i) => path.isAbsolute(i.path))) throw makeError('invalid_path', 'dates.run', { message: 'Expected absolute paths.' });
  if ('spec' in p.data && !req.sources.length) throw makeError('validation', 'dates.run', { message: 'Nothing selected.' });
}

/** Operation runner 'set-dates'. */
export function makeSetDatesRunner(deps: { markRunning: (rec: OperationRecord) => void; onChanged?: (p: string) => void; read?: (p: string) => Promise<MediaMeta | undefined> }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = SetDatesParamsSchema.parse(req.params);
    let items: DatesApplyItem[];
    if ('spec' in params) {
      const plan = await planDates(rec.sources, params.spec, deps.read ?? (async () => undefined), { signal: ctx.signal, wait: () => ctx.gate() });
      if (plan.truncated) throw makeError('validation', 'dates.run', { message: `More than ${MAX_DATES_ITEMS.toLocaleString('en')} items are inside. Choose fewer.` });
      items = plan.items.flatMap((i) => (i.next ? [{ path: i.path, mtimeMs: i.next.mtimeMs, atimeMs: i.next.atimeMs }] : []));
      const left = plan.items.length - items.length;
      if (left) rec.notes = [`${left} item${left === 1 ? ' was' : 's were'} left alone (${[...new Set(plan.items.filter((i) => !i.next).map((i) => i.reason ?? ''))].filter(Boolean).slice(0, 3).join(' ')}).`];
      if (!items.length) throw makeError('validation', 'dates.run', { message: 'None of the items has a date to set.' });
    } else items = params.items;
    rec.itemResults = true;
    rec.progress = { totalItems: items.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const previous: DatesApplyItem[] = [];
    const isUndo = items.some((i) => i.expectMtimeMs !== undefined);
    try {
      for (const it of items) {
        await ctx.gate();
        const name = path.basename(it.path);
        try {
          const st = await fsp.lstat(it.path);
          if (st.isSymbolicLink()) throw makeError('unsupported', 'dates.run', { target: it.path, dataChanged: 'no', message: 'Links are left alone.' });
          if (!st.isFile() && !st.isDirectory()) throw makeError('unsupported', 'dates.run', { target: it.path, dataChanged: 'no', message: 'Not a file or folder.' });
          if (it.expectMtimeMs !== undefined && Math.abs(st.mtimeMs - it.expectMtimeMs) > 1) {
            throw makeError('busy', 'dates.run', { target: it.path, dataChanged: 'no', message: 'Its modification time changed since; it was left alone.' });
          }
          await fsp.utimes(it.path, secs(it.atimeMs), secs(it.mtimeMs));
          const after = await fsp.lstat(it.path);
          previous.push({ path: it.path, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs, expectMtimeMs: after.mtimeMs });
          deps.onChanged?.(it.path);
          rec.results.push({ source: it.path, status: 'done' });
        } catch (err) {
          const shape = toOrbisError(err, 'dates.run', it.path, 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: it.path, status: shape.category === 'unsupported' || shape.category === 'busy' ? 'skipped' : 'failed', error: shape });
        }
        helpers.tick(0, 1, name);
      }
    } finally {
      rec.undo = isUndo
        ? { kind: 'none', reason: 'This put the earlier dates back.' }
        : previous.length
          ? { kind: 'operation', label: 'Undo (put the previous dates back)', request: { type: 'set-dates', sources: [...new Set(previous.map((p) => path.dirname(p.path)))].slice(0, 1000), params: { items: previous } } }
          : { kind: 'none', reason: 'No dates were changed.' };
    }
  };
}
