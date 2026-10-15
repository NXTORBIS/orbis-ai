import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { MediaMeta } from '../../shared/media';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import {
  BUILTIN_ORGANIZE_PRESETS, cameraName, exifDateParts, localParts, MAX_ORGANIZE_FILES, mediaKindOf, OrganizePresetSchema, OrganizeSpecSchema, patternProblem, renderPattern,
  type DateSource, type OrganizeItem, type OrganizePlan, type OrganizePreset, type OrganizeSpec,
} from '../../shared/organize';
import { copyTree, type ExternalRunner, type RunContext } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { isWithin, uniqueName, validateName } from '../fs/paths';

/**
 * Organize by date: photos and videos (or every file) are moved or copied into
 * folders built from a pattern such as {YYYY}/{MM}. The date is the photo's
 * EXIF DateTimeOriginal, the video container's creation time, or — when the
 * user allows it — the file's modification time. Planning (the preview) and
 * the 'organize-date' operation runner use the same functions; the runner
 * re-reads every file's date, never replaces anything (conflicts are asked:
 * keep both or skip) and records an undo that moves the files back (or
 * trashes the copies) and removes the date folders it created once empty.
 */

export type MetaReader = (p: string) => Promise<MediaMeta>;

export const OrganizeParamsSchema = z.object({ spec: OrganizeSpecSchema });

/** Expand the selection into the files to organize (links, special and hidden files inside folders are left out). */
export async function collectOrganizeFiles(sources: string[], spec: Pick<OrganizeSpec, 'recursive' | 'include'>, signal?: AbortSignal): Promise<{ files: string[]; ignored: number; truncated: boolean }> {
  const files: string[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  let truncated = false;
  const wanted = (name: string) => spec.include === 'all' || mediaKindOf(path.extname(name).slice(1)) !== 'other';
  const add = (p: string) => {
    if (seen.has(p)) return;
    if (files.length >= MAX_ORGANIZE_FILES) {
      truncated = true;
      return;
    }
    seen.add(p);
    files.push(p);
  };
  for (const src of sources) {
    if (signal?.aborted) throw makeError('cancelled', 'organize.collect');
    const st = await fsp.lstat(src).catch(() => undefined);
    if (!st) {
      ignored++;
      continue;
    }
    if (st.isFile()) {
      // Explicitly selected files are listed (a file of another type is shown as skipped).
      add(src);
      continue;
    }
    if (!st.isDirectory()) {
      ignored++;
      continue;
    }
    const stack = [src];
    while (stack.length && !truncated) {
      if (signal?.aborted) throw makeError('cancelled', 'organize.collect');
      const dir = stack.pop()!;
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (e.name.startsWith('.')) {
          ignored++;
          continue;
        }
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (spec.recursive) stack.push(p);
        } else if (e.isFile() && wanted(e.name)) add(p);
        else ignored++;
      }
    }
  }
  return { files, ignored, truncated };
}

/** The date (and camera) used for one file, or why it is skipped. */
export function organizeFacts(file: string, st: Stats, meta: MediaMeta | undefined, spec: OrganizeSpec): { parts?: { year: number; month: number; day: number }; source?: DateSource; camera?: string; reason?: string } {
  const ext = path.extname(file).slice(1).toLowerCase();
  const kind = mediaKindOf(ext);
  const camera = cameraName(meta?.exif?.make, meta?.exif?.model);
  if (spec.include === 'media' && kind === 'other') return { reason: 'Not a photo or video.' };
  const taken = exifDateParts(meta?.exif?.takenAt);
  if (taken) return { parts: taken, source: 'exif', camera };
  if (meta?.createdAt) {
    const recorded = localParts(Date.parse(meta.createdAt));
    if (recorded) return { parts: recorded, source: 'video', camera };
  }
  if (spec.withoutTakenDate === 'skip') return { reason: kind === 'video' ? 'No recording date in the file.' : kind === 'photo' ? 'No date taken in the file.' : 'No date taken (not a photo or video).', camera };
  const modified = localParts(st.mtimeMs);
  if (!modified) return { reason: 'The modification date is not usable.', camera };
  return { parts: modified, source: 'modified', camera };
}

/** Plan one file: where it goes and why (no conflict checks). */
export async function planOrganizeFile(file: string, root: string, spec: OrganizeSpec, read: MetaReader): Promise<OrganizeItem> {
  const name = path.basename(file);
  const ext = path.extname(name).slice(1).toLowerCase();
  const kind = mediaKindOf(ext);
  const item: OrganizeItem = { source: file, name, kind, action: 'skip' };
  const st = await fsp.lstat(file).catch(() => undefined);
  if (!st?.isFile()) return { ...item, reason: 'Not a regular file (or it no longer exists).' };
  const meta = kind === 'other' ? undefined : await read(file).catch(() => undefined);
  const f = organizeFacts(file, st, meta, spec);
  item.camera = f.camera;
  if (!f.parts) return { ...item, reason: f.reason };
  const segs = renderPattern(spec.pattern, { ...f.parts, camera: f.camera, ext });
  for (const seg of segs) {
    const v = validateName(seg);
    if (!v.valid) return { ...item, reason: `The folder name “${seg}” cannot be used: ${v.reason}` };
  }
  const targetDir = path.join(root, ...segs);
  const target = path.join(targetDir, name);
  const pad = (n: number) => String(n).padStart(2, '0');
  Object.assign(item, { date: `${f.parts.year}-${pad(f.parts.month)}-${pad(f.parts.day)}`, dateSource: f.source, targetDir, target });
  if (path.resolve(target) === path.resolve(file)) return { ...item, reason: 'Already in place.' };
  item.action = spec.mode;
  return item;
}

/** The preview: every file's destination, date source and conflicts. Nothing is written. */
export async function planOrganize(sources: string[], root: string, spec: OrganizeSpec, read: MetaReader, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; wait?: () => Promise<void> } = {}): Promise<OrganizePlan> {
  const { files, ignored, truncated } = await collectOrganizeFiles(sources, spec, opts.signal);
  const items: OrganizeItem[] = [];
  const claimed = new Set<string>();
  const newFolders = new Set<string>();
  const existingDirs = new Map<string, boolean>();
  const dirExists = async (d: string) => {
    if (!existingDirs.has(d)) existingDirs.set(d, await exists(d));
    return existingDirs.get(d)!;
  };
  for (const file of files) {
    if (opts.signal?.aborted) throw makeError('cancelled', 'organize.plan');
    await opts.wait?.();
    const item = await planOrganizeFile(file, root, spec, read);
    if (item.action !== 'skip' && item.target && item.targetDir) {
      const key = process.platform === 'linux' ? item.target : item.target.toLowerCase();
      if (claimed.has(key)) item.conflict = 'duplicate';
      else if (await exists(item.target)) item.conflict = 'exists';
      claimed.add(key);
      // Every folder level that does not exist yet is new.
      const rel = path.relative(root, item.targetDir).split(path.sep);
      let cur = root;
      for (const seg of rel) {
        cur = path.join(cur, seg);
        if (!newFolders.has(path.relative(root, cur)) && !(await dirExists(cur))) newFolders.add(path.relative(root, cur));
      }
    }
    items.push(item);
    opts.onProgress?.(items.length, files.length);
  }
  return { items, ignored, truncated, newFolders: [...newFolders].sort() };
}

/** Create each missing folder level below `root` (never through a link); returns the folders created. */
async function ensureDirs(root: string, targetDir: string): Promise<string[]> {
  const created: string[] = [];
  const rel = path.relative(root, targetDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw makeError('invalid_path', 'organize.run', { target: targetDir, message: 'The folder would be outside the destination.' });
  let cur = root;
  for (const seg of rel ? rel.split(path.sep) : []) {
    cur = path.join(cur, seg);
    let st = await fsp.lstat(cur).catch(() => undefined);
    if (!st) {
      try {
        await fsp.mkdir(cur);
        created.push(cur);
        continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        st = await fsp.lstat(cur);
      }
    }
    if (st.isSymbolicLink()) throw makeError('unsupported', 'organize.run', { target: cur, message: `“${seg}” in the destination is a link; files are not moved through links.` });
    if (!st.isDirectory()) throw makeError('not_a_directory', 'organize.run', { target: cur, message: `“${seg}” already exists in the destination and is not a folder.` });
  }
  return created;
}

/** Move without replacing anything: hard link + unlink on the same drive, else copy (verified) and remove. */
async function moveNoClobber(src: string, target: string, ctx: RunContext): Promise<void> {
  let linked = false;
  try {
    await fsp.link(src, target);
    linked = true;
    await fsp.unlink(src);
    return;
  } catch (err) {
    // The source could not be removed (e.g. a read-only folder): take the new link away again, nothing moved.
    if (linked) {
      await fsp.unlink(target).catch(() => undefined);
      throw err;
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new OrbisError({ category: 'already_exists', operation: 'organize.run', message: `“${path.basename(target)}” appeared in the destination meanwhile and was not replaced.`, target, dataChanged: 'no', retryable: true });
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS' && code !== 'EMLINK') throw err;
  }
  if ((await fsp.stat(src)).dev === (await fsp.stat(path.dirname(target))).dev) {
    // No hard links on this file system: rename after a final existence check.
    if (await exists(target)) throw makeError('already_exists', 'organize.run', { target });
    await fsp.rename(src, target);
    return;
  }
  const before = await fsp.stat(src);
  await copyOne(src, target, ctx);
  const after = await fsp.stat(target);
  if (after.size !== before.size) throw makeError('io', 'organize.run', { target: src, message: 'The copy could not be verified, so the original was kept.', dataChanged: 'yes' });
  await fsp.unlink(src);
}

/** Copy one file through a temporary sibling (fsync, size check, committed with link() so nothing is replaced). */
function copyOne(src: string, target: string, ctx: RunContext): Promise<void> {
  return copyTree(src, target, ctx, () => undefined, { merge: false, replaceFile: false, askChild: async () => 'skip' as const, failures: [], skipped: 0 });
}

export function validateOrganizeRequest(req: OperationRequest): void {
  const parsed = OrganizeParamsSchema.safeParse(req.params);
  if (!parsed.success) throw makeError('validation', 'organize.run', { message: parsed.error.issues[0]?.message ?? 'The organize settings are not valid.' });
  if (!req.destination) throw makeError('validation', 'organize.run', { message: 'Choose a destination folder.' });
  if (!req.sources.length) throw makeError('validation', 'organize.run', { message: 'Nothing to organize.' });
  if (req.sources.length > MAX_ORGANIZE_FILES) throw makeError('validation', 'organize.run', { message: `At most ${MAX_ORGANIZE_FILES.toLocaleString('en')} files at a time.` });
}

export function makeOrganizeRunner(deps: { read: MetaReader; markRunning: (rec: OperationRecord) => void; onMoved?: (from: string, to: string) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const { spec } = OrganizeParamsSchema.parse(req.params);
    const problem = patternProblem(spec.pattern);
    if (problem) throw makeError('validation', 'organize.run', { message: problem });
    const root = rec.destination!;
    const rootSt = await fsp.stat(root).catch(() => undefined);
    if (!rootSt?.isDirectory()) throw makeError('not_a_directory', 'organize.run', { target: root, message: 'The destination folder does not exist.' });
    rec.progress = { totalItems: rec.sources.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const done: Array<{ source: string; destination: string }> = [];
    const createdDirs: string[] = [];
    try {
      for (const src of rec.sources) {
        await ctx.gate();
        const name = path.basename(src);
        try {
          const item = await planOrganizeFile(src, root, spec, deps.read);
          if (item.action === 'skip' || !item.target || !item.targetDir) {
            rec.results.push({ source: src, status: 'skipped', error: { category: 'validation', operation: 'organize.run', message: item.reason ?? 'Left where it is.', target: src, dataChanged: 'no', retryable: false } });
            helpers.tick(0, 1, name);
            continue;
          }
          if (isWithin(src, item.targetDir)) throw makeError('validation', 'organize.run', { target: src, message: 'A file cannot be organized into itself.' });
          createdDirs.push(...(await ensureDirs(root, item.targetDir)));
          let target = item.target;
          if (await exists(target)) {
            const [ss, ds] = await Promise.all([fsp.lstat(src), fsp.lstat(target)]);
            if (ss.ino === ds.ino && ss.dev === ds.dev) {
              rec.results.push({ source: src, destination: target, status: 'skipped', error: { category: 'validation', operation: 'organize.run', message: 'Already in place.', target: src, dataChanged: 'no', retryable: false } });
              helpers.tick(0, 1, name);
              continue;
            }
            const action = await helpers.ask({
              source: src,
              destination: target,
              sourceKind: 'file',
              destinationKind: ds.isDirectory() ? 'directory' : ds.isSymbolicLink() ? 'symlink' : ds.isFile() ? 'file' : 'other',
              sourceSize: ss.size,
              destinationSize: ds.isFile() ? ds.size : undefined,
              sourceModifiedMs: ss.mtimeMs,
              destinationModifiedMs: ds.mtimeMs,
              suggestedName: await uniqueName(item.targetDir, name, exists),
              remaining: rec.sources.length - rec.results.length,
              allowed: ['keep-both', 'skip'],
            });
            if (action !== 'keep-both') {
              rec.results.push({ source: src, destination: target, status: 'skipped' });
              helpers.tick(ss.size, 1, name);
              continue;
            }
            target = path.join(item.targetDir, await uniqueName(item.targetDir, name, exists));
          }
          const size = (await fsp.lstat(src)).size;
          if (spec.mode === 'move') {
            await moveNoClobber(src, target, ctx);
            deps.onMoved?.(src, target);
          } else {
            await copyOne(src, target, ctx);
            deps.onCreated?.(target);
          }
          done.push({ source: src, destination: target });
          rec.results.push({ source: src, destination: target, status: 'done' });
          helpers.tick(size, 1, name);
        } catch (err) {
          const shape = toOrbisError(err, 'organize.run', src, 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: src, status: 'failed', error: shape });
          helpers.tick(0, 1, name);
        }
      }
    } finally {
      // Undo: moves go back to their folders (copies go to the Trash); date folders created here are removed once empty.
      rec.undo = done.length
        ? { kind: 'transfer', mode: spec.mode, items: done, cleanupDirs: createdDirs }
        : { kind: 'none', reason: spec.mode === 'move' ? 'Nothing was moved.' : 'Nothing was copied.' };
      if (createdDirs.length) rec.notes = [`${createdDirs.length} folder${createdDirs.length === 1 ? ' was' : 's were'} created.`];
    }
  };
}

const PRESETS_KEY = 'organize.presets';
export const MAX_ORGANIZE_PRESETS = 50;

/** Saved folder patterns (per profile, catalogue key-value table) after the built-in ones. */
export class OrganizePresetStore {
  constructor(private readonly kv: { getKv<T>(key: string, fallback: T): T; setKv(key: string, value: unknown): void }) {}

  private saved(): OrganizePreset[] {
    const raw = z.array(z.unknown()).safeParse(this.kv.getKv<unknown>(PRESETS_KEY, []));
    if (!raw.success) return [];
    return raw.data.flatMap((x) => {
      const p = OrganizePresetSchema.safeParse(x);
      return p.success && !p.data.builtIn ? [p.data] : [];
    });
  }

  list(): OrganizePreset[] {
    return [...BUILTIN_ORGANIZE_PRESETS, ...this.saved().sort((a, b) => a.name.localeCompare(b.name))];
  }

  save(name: string, pattern: string): OrganizePreset {
    const n = name.trim();
    if (!n) throw makeError('validation', 'organize.savePreset', { message: 'Enter a name for the preset.' });
    if (BUILTIN_ORGANIZE_PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw makeError('validation', 'organize.savePreset', { message: 'A built-in preset has this name. Choose another name.' });
    const problem = patternProblem(pattern);
    if (problem) throw makeError('validation', 'organize.savePreset', { message: problem });
    const list = this.saved();
    const existing = list.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!existing && list.length >= MAX_ORGANIZE_PRESETS) throw makeError('validation', 'organize.savePreset', { message: `Up to ${MAX_ORGANIZE_PRESETS} presets can be saved. Delete one first.` });
    const preset: OrganizePreset = { id: existing?.id ?? crypto.randomUUID(), name: n.slice(0, 80), pattern: pattern.trim(), savedMs: Date.now() };
    this.kv.setKv(PRESETS_KEY, [...list.filter((p) => p.id !== preset.id), preset]);
    return preset;
  }

  delete(id: string): boolean {
    if (id.startsWith('builtin:')) throw makeError('validation', 'organize.deletePreset', { message: 'Built-in presets cannot be deleted.' });
    const list = this.saved();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    this.kv.setKv(PRESETS_KEY, next);
    return true;
  }
}
