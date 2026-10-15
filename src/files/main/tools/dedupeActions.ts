import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import { checkDedupePlan, type DedupePlanGroup } from '../../shared/dedupe';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner, PlatformOps, RunContext, RunnerHelpers } from '../ops/OperationManager';
import { uniqueName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import { sha256File } from './duplicates';

/**
 * The 'dedupe' operation: acts on copies the user marked in duplicate groups.
 *
 *  - trash: moves marked copies to the Trash (undoable on Linux like any move to the Trash);
 *  - move: moves marked copies into one folder (keep both on name clashes; undoable);
 *  - hardlink: replaces each marked copy with a hard link to the kept copy, so the
 *    data is stored once. Same drive only; Linux and macOS only.
 *
 * Before touching a marked copy the runner checks, at that moment, that a kept
 * copy of the same group still exists and has exactly the same contents
 * (SHA-256 of both, read now). A group with no kept copy is refused before
 * anything starts, so no action can remove every copy.
 */

const pathStr = z.string().min(1).max(32767);

export const DedupeParamsSchema = z.object({
  action: z.enum(['trash', 'move', 'hardlink']),
  groups: z
    .array(z.object({
      keep: z.array(pathStr).min(1, 'At least one copy of every group must be kept.').max(100_000),
      remove: z.array(pathStr).min(1).max(100_000),
      size: z.number().int().nonnegative(),
      verification: z.enum(['sha256', 'name-size']),
    }))
    .min(1)
    .max(500_000),
});
export type DedupeParams = z.infer<typeof DedupeParamsSchema>;

export const HARDLINK_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['linux', 'darwin', 'freebsd', 'openbsd']);

/** Synchronous checks run when the operation is requested (and again when it runs). */
export function validateDedupeRequest(req: OperationRequest, platform: NodeJS.Platform = process.platform): DedupeParams {
  const parsed = DedupeParamsSchema.safeParse(req.params ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw makeError('validation', 'ops.dedupe', { message: issue?.message?.startsWith('At least one') ? issue.message : 'The duplicate action request is not valid.', cause: `${issue?.path.join('.')}: ${issue?.message}` });
  }
  const p = parsed.data;
  if (p.groups.some((g) => [...g.keep, ...g.remove].some((x) => x.includes('\0') || !path.isAbsolute(x)))) {
    throw makeError('invalid_path', 'ops.dedupe', { message: 'Expected absolute paths.' });
  }
  const groups: DedupePlanGroup[] = p.groups.map((g) => ({ ...g, keep: g.keep.map((x) => path.resolve(x)), remove: g.remove.map((x) => path.resolve(x)) }));
  const errors = checkDedupePlan(groups);
  if (errors.length) throw makeError('validation', 'ops.dedupe', { message: errors[0]!, cause: errors.slice(0, 20).join('; ') });
  const sources = new Set(req.sources.map((s) => path.resolve(s)));
  const marked = new Set(groups.flatMap((g) => g.remove));
  if (sources.size !== marked.size || [...marked].some((m) => !sources.has(m))) {
    throw makeError('validation', 'ops.dedupe', { message: 'The items to act on do not match the marked copies.' });
  }
  if (p.action === 'move' && !req.destination) throw makeError('validation', 'ops.dedupe', { message: 'Choose a folder to move the marked copies to.' });
  if (p.action === 'move' && req.destination && groups.some((g) => g.remove.some((r) => path.dirname(r) === path.resolve(req.destination!)))) {
    throw makeError('validation', 'ops.dedupe', { message: 'Some marked copies are already in the destination folder.' });
  }
  if (p.action === 'hardlink' && !HARDLINK_PLATFORMS.has(platform)) {
    throw makeError('unsupported', 'ops.dedupe', { message: 'Replacing duplicates with hard links is offered on Linux and macOS only. On Windows, move the copies to the Recycle Bin instead.' });
  }
  return { action: p.action, groups };
}

export interface DedupeDeps {
  platform: PlatformOps;
  markRunning: (rec: OperationRecord) => void;
  onMoved?: (from: string, to: string) => void;
  onRemoved?: (p: string) => void;
  onChanged?: (p: string) => void;
}

interface Keeper { path: string; st: fs.Stats; real: string; hash: string }

/** Find a kept copy that is still a regular file and hash it now. */
async function resolveKeeper(group: DedupePlanGroup, ctx: RunContext): Promise<Keeper> {
  const problems: string[] = [];
  for (const k of group.keep) {
    const st = await fsp.lstat(k).catch(() => undefined);
    if (!st) {
      problems.push(`${path.basename(k)} no longer exists`);
      continue;
    }
    if (!st.isFile()) {
      problems.push(`${path.basename(k)} is not a regular file`);
      continue;
    }
    if (st.size !== group.size) {
      problems.push(`${path.basename(k)} changed size`);
      continue;
    }
    const hash = await sha256File(k, ctx.signal, { get isPaused() { return ctx.paused; }, wait: () => ctx.gate() });
    return { path: k, st, real: await fsp.realpath(k), hash };
  }
  throw makeError('not_found', 'ops.dedupe', { message: `No kept copy of this group is available (${problems.join('; ')}), so its marked copies were left in place.` });
}

/** Check a marked copy against the kept copy right now: a different directory entry with identical contents. */
async function verifyCopy(target: string, keeper: Keeper, size: number, ctx: RunContext): Promise<fs.Stats> {
  const st = await fsp.lstat(target);
  if (!st.isFile()) throw makeError('unsupported', 'ops.dedupe', { message: 'Not a regular file (links and folders are never acted on).', target });
  if ((await fsp.realpath(target)) === keeper.real) throw makeError('validation', 'ops.dedupe', { message: 'This is the kept copy itself (reached through another path), so it was left alone.', target });
  if (st.size !== size || st.size !== keeper.st.size) throw makeError('validation', 'ops.dedupe', { message: 'Its size changed since the search, so it was left alone.', target });
  const h = await sha256File(target, ctx.signal, { get isPaused() { return ctx.paused; }, wait: () => ctx.gate() });
  if (h !== keeper.hash) throw makeError('validation', 'ops.dedupe', { message: `Its contents differ from the kept copy ${path.basename(keeper.path)}, so it was left alone.`, target });
  return st;
}

async function moveVerified(src: string, destDir: string, helpers: RunnerHelpers, ctx: RunContext): Promise<string> {
  const name = await uniqueName(destDir, path.basename(src), exists);
  const target = path.join(destDir, name);
  try {
    await fsp.link(src, target); // same drive: a new name for the same file, never over an existing one
    await fsp.unlink(src);
    return target;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw err;
  }
  // Another drive (or no hard links there): copy to a temporary sibling, verify, commit, then remove the original.
  const tmp = path.join(destDir, `.orbis-part-${crypto.randomUUID()}`);
  helpers.temp(tmp);
  await fsp.copyFile(src, tmp, fs.constants.COPYFILE_EXCL);
  const gate = { get isPaused() { return ctx.paused; }, wait: () => ctx.gate() };
  const [a, b] = await Promise.all([sha256File(src, ctx.signal, gate), sha256File(tmp, ctx.signal, gate)]);
  if (a !== b) throw makeError('io', 'ops.dedupe', { message: 'The copy did not verify; the original was kept.', target: src });
  const st = await fsp.stat(src);
  await fsp.utimes(tmp, st.atime, st.mtime).catch(() => undefined);
  await fsp.link(tmp, target);
  await fsp.unlink(tmp);
  helpers.committed(tmp);
  await fsp.unlink(src);
  return target;
}

/** Replace `target` with a hard link to the kept copy: link to a temporary sibling, re-check, then rename over it atomically. */
async function replaceWithLink(target: string, before: fs.Stats, keeper: Keeper, helpers: RunnerHelpers): Promise<void> {
  const tmp = path.join(path.dirname(target), `.orbis-part-${crypto.randomUUID()}`);
  helpers.temp(tmp);
  try {
    await fsp.link(keeper.path, tmp);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') throw makeError('unsupported', 'ops.dedupe', { message: 'The kept copy is on another drive; hard links only work within one drive.', target });
    throw err;
  }
  // Nothing may have changed between verification and the swap.
  const [now, k] = await Promise.all([fsp.lstat(target), fsp.lstat(keeper.path)]);
  if (now.ino !== before.ino || now.size !== before.size || now.mtimeMs !== before.mtimeMs || k.ino !== keeper.st.ino || k.mtimeMs !== keeper.st.mtimeMs || k.size !== keeper.st.size) {
    await fsp.unlink(tmp).catch(() => undefined);
    helpers.committed(tmp);
    throw makeError('busy', 'ops.dedupe', { message: 'The file changed while it was being checked, so it was left alone.', target });
  }
  await fsp.rename(tmp, target);
  helpers.committed(tmp);
  const after = await fsp.lstat(target);
  if (after.ino !== keeper.st.ino || after.dev !== keeper.st.dev) throw makeError('io', 'ops.dedupe', { message: 'The hard link did not verify.', target });
}

export function makeDedupeRunner(deps: DedupeDeps): { run: ExternalRunner; validate: (req: OperationRequest) => void } {
  const run: ExternalRunner = async (rec, req, ctx, helpers) => {
    const plan = validateDedupeRequest(req);
    const total = plan.groups.reduce((a, g) => a + g.remove.length, 0);
    rec.progress = { totalItems: total, completedItems: 0, completedBytes: 0, totalBytes: plan.groups.reduce((a, g) => a + g.size * g.remove.length, 0) };
    let destDir: string | undefined;
    if (plan.action === 'move') {
      destDir = rec.destination!;
      const st = await fsp.stat(destDir).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'ops.dedupe', { message: 'The folder to move the copies to does not exist.', target: destDir });
    }
    if (plan.action === 'trash' && !deps.platform.trashSupported) throw makeError('unsupported', 'ops.dedupe', { message: 'The Trash is not available on this system.' });
    deps.markRunning(rec);
    const trashed: Array<{ original: string; trashDir: string; name: string }> = [];
    let unlocated = 0;
    const moved: Array<{ source: string; destination: string }> = [];
    try {
      for (const group of plan.groups) {
        await ctx.gate();
        let keeper: Keeper;
        try {
          keeper = await resolveKeeper(group, ctx);
        } catch (err) {
          const shape = toOrbisError(err, 'ops.dedupe', group.keep[0], 'no');
          if (shape.category === 'cancelled') throw err;
          for (const r of group.remove) {
            rec.results.push({ source: r, status: 'failed', error: { ...shape, target: r } });
            helpers.tick(0, 1, path.basename(r));
          }
          continue;
        }
        for (const target of group.remove) {
          await ctx.gate();
          try {
            const st = await verifyCopy(target, keeper, group.size, ctx);
            if (plan.action === 'trash') {
              const since = Date.now();
              await deps.platform.trash(target);
              deps.onRemoved?.(target);
              if (deps.platform.locateTrashed) {
                const loc = await deps.platform.locateTrashed(target, since).catch(() => undefined);
                if (loc) trashed.push({ original: target, trashDir: loc.trashDir, name: loc.name });
                else unlocated++;
              }
              rec.results.push({ source: target, status: 'done' });
            } else if (plan.action === 'move') {
              const dest = await moveVerified(target, destDir!, helpers, ctx);
              moved.push({ source: target, destination: dest });
              deps.onMoved?.(target, dest);
              rec.results.push({ source: target, destination: dest, status: 'done' });
            } else {
              if (st.dev !== keeper.st.dev) throw makeError('unsupported', 'ops.dedupe', { message: 'The kept copy is on another drive; hard links only work within one drive.', target });
              if (st.ino === keeper.st.ino) {
                rec.results.push({ source: target, status: 'skipped', error: { category: 'already_exists', operation: 'ops.dedupe', message: 'Already a hard link to the kept copy.', target, dataChanged: 'no', retryable: false } });
                helpers.tick(0, 1, path.basename(target));
                continue;
              }
              await replaceWithLink(target, st, keeper, helpers);
              deps.onChanged?.(target);
              rec.results.push({ source: target, destination: keeper.path, status: 'done' });
            }
            helpers.tick(group.size, 1, path.basename(target));
          } catch (err) {
            const shape = toOrbisError(err, 'ops.dedupe', target, 'no');
            if (shape.category === 'cancelled') throw err;
            rec.results.push({ source: target, status: 'failed', error: shape });
            helpers.tick(0, 1, path.basename(target));
          }
        }
      }
    } finally {
      if (plan.action === 'trash') {
        const hint = deps.platform.trashRestoreHint ?? 'Restore them from the system Trash.';
        if (!deps.platform.locateTrashed) rec.undo = { kind: 'none', reason: `Orbis Files cannot restore from the Trash on this system. ${hint}` };
        else if (trashed.length) {
          rec.undo = { kind: 'trash', items: trashed };
          if (unlocated) rec.notes = [...(rec.notes ?? []), `${unlocated} item(s) could not be found in the Trash afterwards, so Undo does not cover them.`];
        } else rec.undo = { kind: 'none', reason: 'Nothing was moved to the Trash.' };
      } else if (plan.action === 'move') {
        rec.undo = moved.length ? { kind: 'transfer', mode: 'move', items: moved } : { kind: 'none', reason: 'Nothing was moved.' };
      } else {
        rec.undo = { kind: 'none', reason: 'Hard links are not undone automatically. Every path still opens the same contents; copy a file to give it its own data again.' };
        const linked = rec.results.filter((r) => r.status === 'done').length;
        if (linked) rec.notes = [...(rec.notes ?? []), `${linked} copy(ies) now share the kept copy's data, permissions and modification time.`];
      }
    }
  };
  return { run, validate: (req) => void validateDedupeRequest(req) };
}
