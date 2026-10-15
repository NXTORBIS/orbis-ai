import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import { FlattenSpecSchema, MAX_FLATTEN_FILES, type FlattenMove, type FlattenPlan, type FlattenSpec } from '../../shared/powerTools';
import type { ExternalRunner, PlatformOps } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { isWithin, uniqueName } from '../fs/paths';
import { moveNoClobber } from '../fs/trash';

/**
 * Flatten folder: every file in the subfolders of a folder is moved up into
 * it. Links are left where they are (moving a relative link would break it),
 * hidden items are left unless asked for. Name conflicts are asked with the
 * usual conflict prompt (Keep both, Skip, Replace — a replaced item goes to
 * the Trash first). Emptied subfolders can be removed. The undo is an
 * operation of its own ('flatten-restore') that recreates the removed
 * folders with their permissions, moves every file back to where it was,
 * restores replaced items from the Trash where it can, and puts back the
 * folders' modification times.
 */

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const key = (n: string) => (caseInsensitive ? n.toLowerCase() : n);

/** Preview (and the runner's own plan): what moves where, conflicts, and which folders end up empty. */
export async function planFlatten(root: string, spec: FlattenSpec, opts: { signal?: AbortSignal; wait?: () => Promise<void>; onProgress?: (n: number) => void } = {}): Promise<FlattenPlan & { dirs: string[] }> {
  const st = await fsp.lstat(root).catch(() => undefined);
  if (!st?.isDirectory()) throw makeError('not_a_directory', 'flatten.plan', { target: root, message: 'This folder no longer exists.' });
  const plan: FlattenPlan & { dirs: string[] } = { root, moves: [], folders: 0, emptyAfter: [], links: 0, hidden: 0, others: 0, truncated: false, dirs: [] };
  const rootNames = new Set<string>();
  const top = (await fsp.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  // Each folder: does it keep anything (an entry that is not moved)?
  const keeps = new Map<string, boolean>();
  const children = new Map<string, string[]>();
  const queue: Array<{ dir: string; depth: number }> = [];
  for (const e of top) {
    rootNames.add(key(e.name));
    if (e.isDirectory() && (spec.includeHidden || !e.name.startsWith('.'))) queue.push({ dir: path.join(root, e.name), depth: 1 });
  }
  const files: Array<{ source: string; depth: number }> = [];
  while (queue.length) {
    if (opts.signal?.aborted) throw makeError('cancelled', 'flatten.plan');
    await opts.wait?.();
    const { dir, depth } = queue.shift()!;
    plan.folders++;
    plan.dirs.push(dir);
    keeps.set(dir, false);
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => undefined);
    if (!entries) {
      keeps.set(dir, true); // unreadable: never removed
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const kids: string[] = [];
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (!spec.includeHidden && e.name.startsWith('.')) {
        plan.hidden++;
        keeps.set(dir, true);
      } else if (e.isSymbolicLink()) {
        plan.links++;
        keeps.set(dir, true);
      } else if (e.isDirectory()) {
        queue.push({ dir: p, depth: depth + 1 });
        kids.push(p);
      } else if (e.isFile()) {
        if (files.length >= MAX_FLATTEN_FILES) {
          plan.truncated = true;
          keeps.set(dir, true);
        } else files.push({ source: p, depth });
      } else {
        plan.others++;
        keeps.set(dir, true);
      }
    }
    children.set(dir, kids);
    if (files.length % 1000 === 0) opts.onProgress?.(files.length);
  }
  // Shallow files first, so a file nearer the top gets its plain name.
  files.sort((a, b) => a.depth - b.depth || a.source.localeCompare(b.source));
  const claimed = new Set<string>();
  for (const f of files) {
    const name = path.basename(f.source);
    const m: FlattenMove = { source: f.source, rel: path.relative(root, f.source).split(path.sep).join('/'), name, target: path.join(root, name) };
    if (rootNames.has(key(name))) m.conflict = 'exists';
    else if (claimed.has(key(name))) m.conflict = 'twice';
    claimed.add(key(name));
    plan.moves.push(m);
  }
  // A folder is empty afterwards when it keeps nothing itself and all its subfolders are empty afterwards.
  const emptyAfter = (d: string): boolean => !keeps.get(d) && (children.get(d) ?? []).every(emptyAfter);
  plan.emptyAfter = plan.dirs.filter(emptyAfter).sort((a, b) => b.split(path.sep).length - a.split(path.sep).length || b.localeCompare(a));
  return plan;
}

const TimesSchema = z.object({ atimeMs: z.number().finite(), mtimeMs: z.number().finite() });
const DirInfoSchema = TimesSchema.extend({ path: z.string().min(1), mode: z.number().int().nonnegative(), removed: z.boolean() });
export const FlattenRestoreParamsSchema = z.object({
  root: z.string().min(1),
  moves: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).max(MAX_FLATTEN_FILES),
  dirs: z.array(DirInfoSchema).max(MAX_FLATTEN_FILES * 2),
  rootTimes: TimesSchema,
  trashed: z.array(z.object({ original: z.string().min(1), trashDir: z.string().min(1), name: z.string().min(1) })).max(MAX_FLATTEN_FILES),
});
type RestoreParams = z.infer<typeof FlattenRestoreParamsSchema>;

export function validateFlattenRequest(req: OperationRequest): void {
  if (req.sources.length !== 1) throw makeError('validation', 'flatten.run', { message: 'Flatten one folder at a time.' });
  const p = FlattenSpecSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'flatten.run', { message: 'The flatten settings are not valid.' });
}

export function validateFlattenRestoreRequest(req: OperationRequest): void {
  const p = FlattenRestoreParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'flatten.restore', { message: 'The recorded folder structure is not valid.' });
  const { root, moves, dirs } = p.data;
  const inside = (x: string) => path.isAbsolute(x) && isWithin(root, x) && path.resolve(x) !== path.resolve(root);
  if (!moves.every((m) => inside(m.from) && inside(m.to)) || !dirs.every((d) => inside(d.path))) throw makeError('validation', 'flatten.restore', { message: 'The recorded folder structure points outside the folder.' });
}

export interface FlattenDeps {
  platform: PlatformOps;
  markRunning: (rec: OperationRecord) => void;
  onMoved?: (from: string, to: string) => void;
  /** Put an item the flatten replaced (moved to the Trash) back where it was; throws when that is not possible. */
  restoreTrashed?: (item: { original: string; trashDir: string; name: string }) => Promise<void>;
}

/** Operation runner 'flatten'. */
export function makeFlattenRunner(deps: FlattenDeps): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const spec = FlattenSpecSchema.parse(req.params);
    const root = rec.sources[0]!;
    const plan = await planFlatten(root, spec, { signal: ctx.signal, wait: () => ctx.gate() });
    if (plan.truncated) throw makeError('validation', 'flatten.run', { target: root, message: `More than ${MAX_FLATTEN_FILES.toLocaleString('en')} files are inside. Flatten smaller folders.` });
    // Everything needed to put the structure back exactly.
    const rootSt = await fsp.stat(root);
    const dirInfo = new Map<string, z.infer<typeof DirInfoSchema>>();
    for (const d of plan.dirs) {
      const s = await fsp.lstat(d).catch(() => undefined);
      if (s) dirInfo.set(d, { path: d, mode: s.mode & 0o7777, atimeMs: s.atimeMs, mtimeMs: s.mtimeMs, removed: false });
    }
    rec.itemResults = true;
    rec.progress = { totalItems: plan.moves.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const moved: RestoreParams['moves'] = [];
    const trashed: RestoreParams['trashed'] = [];
    const setUndo = () => {
      rec.undo = moved.length || [...dirInfo.values()].some((d) => d.removed)
        ? { kind: 'operation', label: 'Undo flatten (put the files back in their folders)', request: { type: 'flatten-restore', sources: [root], params: { root, moves: moved, dirs: [...dirInfo.values()], rootTimes: { atimeMs: rootSt.atimeMs, mtimeMs: rootSt.mtimeMs }, trashed } satisfies RestoreParams } }
        : { kind: 'none', reason: 'Nothing was moved.' };
    };
    try {
      for (const m of plan.moves) {
        await ctx.gate();
        let target = path.join(root, m.name);
        try {
          const src = await fsp.lstat(m.source);
          if (!src.isFile()) throw makeError('not_found', 'flatten.run', { target: m.source, message: 'It changed into something other than a file after the preview.' });
          const there = await fsp.lstat(target).catch(() => undefined);
          if (there) {
            const action = await helpers.ask({
              source: m.source, destination: target,
              sourceKind: 'file', destinationKind: there.isDirectory() ? 'directory' : there.isSymbolicLink() ? 'symlink' : there.isFile() ? 'file' : 'other',
              sourceSize: src.size, destinationSize: there.isFile() ? there.size : undefined, sourceModifiedMs: src.mtimeMs, destinationModifiedMs: there.mtimeMs,
              suggestedName: await uniqueName(root, m.name, exists), remaining: plan.moves.length - moved.length,
              allowed: deps.platform.trashSupported ? ['keep-both', 'skip', 'replace'] : ['keep-both', 'skip'],
            });
            if (action === 'skip') {
              rec.results.push({ source: m.source, destination: target, status: 'skipped' });
              helpers.tick(0, 1, m.name);
              continue;
            }
            if (action === 'keep-both') target = path.join(root, await uniqueName(root, m.name, exists));
            else if (action === 'replace') {
              if (!deps.platform.trashSupported) throw makeError('unsupported', 'flatten.run', { target, message: 'Replacing needs the Trash, which is not available. Choose Keep both or Skip.' });
              const since = Date.now();
              await deps.platform.trash(target);
              const loc = await deps.platform.locateTrashed?.(target, since).catch(() => undefined);
              if (loc) trashed.push({ original: target, trashDir: loc.trashDir, name: loc.name });
              else rec.notes = [...(rec.notes ?? []), `${path.basename(target)} was replaced; the earlier item is in the Trash.`];
            }
          }
          await moveNoClobber(m.source, target, 'flatten.run');
          moved.push({ from: m.source, to: target });
          deps.onMoved?.(m.source, target);
          rec.results.push({ source: m.source, destination: target, status: 'done' });
        } catch (err) {
          const shape = toOrbisError(err, 'flatten.run', m.source, 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: m.source, destination: target, status: 'failed', error: shape });
        }
        helpers.tick(0, 1, m.name);
      }
      if (spec.removeEmpty) {
        let removed = 0;
        // Deepest first; a folder that still holds anything is left (rmdir refuses).
        const all = [...dirInfo.keys()].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length || b.localeCompare(a));
        for (const d of all) {
          if (await fsp.rmdir(d).then(() => true, () => false)) {
            dirInfo.get(d)!.removed = true;
            removed++;
            rec.results.push({ source: d, status: 'done' });
          }
        }
        if (removed) rec.notes = [...(rec.notes ?? []), `${removed} emptied folder${removed === 1 ? ' was' : 's were'} removed (Undo creates ${removed === 1 ? 'it' : 'them'} again).`];
      }
    } finally {
      setUndo();
    }
  };
}

/** Operation runner 'flatten-restore' (the undo of a flatten). */
export function makeFlattenRestoreRunner(deps: FlattenDeps): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const p = FlattenRestoreParamsSchema.parse(req.params);
    rec.itemResults = true;
    rec.progress = { totalItems: p.moves.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    // 1. Folders that were removed, outermost first, with their permissions.
    const removed = p.dirs.filter((d) => d.removed).sort((a, b) => a.path.split(path.sep).length - b.path.split(path.sep).length);
    for (const d of removed) {
      await ctx.gate();
      try {
        await fsp.mkdir(d.path);
        await fsp.chmod(d.path, d.mode);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || !(await fsp.lstat(d.path)).isDirectory()) {
          rec.results.push({ source: d.path, status: 'failed', error: toOrbisError(err, 'flatten.restore', d.path, 'no') });
        }
      }
    }
    // 2. Files back where they were; never over something that is there now.
    for (const m of p.moves) {
      await ctx.gate();
      const name = path.basename(m.from);
      try {
        if (!(await exists(m.to))) throw makeError('not_found', 'flatten.restore', { target: m.to, message: `${path.basename(m.to)} is no longer in ${path.dirname(m.to)}; it was left alone.` });
        let back = m.from;
        if (await exists(back)) {
          const action = await helpers.ask({ source: m.to, destination: back, sourceKind: 'file', destinationKind: 'file', suggestedName: await uniqueName(path.dirname(back), name, exists), remaining: p.moves.length - rec.results.length, allowed: ['keep-both', 'skip'] });
          if (action !== 'keep-both') {
            rec.results.push({ source: m.to, destination: back, status: 'skipped' });
            helpers.tick(0, 1, name);
            continue;
          }
          back = path.join(path.dirname(back), await uniqueName(path.dirname(back), name, exists));
        }
        await moveNoClobber(m.to, back, 'flatten.restore');
        deps.onMoved?.(m.to, back);
        rec.results.push({ source: m.to, destination: back, status: 'done' });
      } catch (err) {
        const shape = toOrbisError(err, 'flatten.restore', m.to, 'no');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: m.to, destination: m.from, status: shape.category === 'not_found' ? 'skipped' : 'failed', error: shape });
      }
      helpers.tick(0, 1, name);
    }
    // 3. Items the flatten replaced, back from the Trash.
    for (const t of p.trashed) {
      try {
        if (!deps.restoreTrashed) throw makeError('unsupported', 'flatten.restore', { message: 'Restore it from the Trash.' });
        await deps.restoreTrashed(t);
        rec.results.push({ source: path.join(t.trashDir, 'files', t.name), destination: t.original, status: 'done' });
      } catch (err) {
        rec.results.push({ source: path.join(t.trashDir, 'files', t.name), destination: t.original, status: 'failed', error: { ...toOrbisError(err, 'flatten.restore', t.original, 'no'), message: `${path.basename(t.original)} (replaced by the flatten) could not be put back: ${toOrbisError(err, 'flatten.restore').message}` } });
      }
    }
    // 4. Folder times, deepest first (moving entries changed them), then the folder itself.
    const byDepth = [...p.dirs].sort((a, b) => b.path.split(path.sep).length - a.path.split(path.sep).length);
    for (const d of byDepth) await fsp.utimes(d.path, d.atimeMs / 1000, d.mtimeMs / 1000).catch(() => undefined);
    await fsp.utimes(p.root, p.rootTimes.atimeMs / 1000, p.rootTimes.mtimeMs / 1000).catch(() => undefined);
    rec.undo = { kind: 'none', reason: 'This was the undo of a flatten. Flatten the folder again if you want.' };
  };
}
