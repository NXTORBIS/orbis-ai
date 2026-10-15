import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import {
  planRetention,
  versionName,
  type BackupJob,
  type ManifestEntry,
  type StorageMode,
  type VersionManifest,
  type VersionStats,
} from '../../shared/backup';
import type { OperationRecord } from '../../shared/operations';
import type { ExternalRunner, RunContext, RunnerHelpers } from '../ops/OperationManager';
import { isWithin } from '../fs/paths';
import { scanSide, type ScanEntry } from '../sync/engine';
import { makeFilter } from '../sync/glob';
import {
  ensureStore,
  fsyncDir,
  listVersions,
  MANIFEST,
  OBJECTS,
  objectPath,
  PART_PREFIX,
  probeHardLinks,
  realpathOr,
  removeVersionDir,
  sourceLabels,
  treePath,
  writeFileAtomic,
} from './format';

/**
 * The 'backup' operation runner: makes one new version of a backup job.
 *
 *  1. The sources are walked without following links (include/exclude patterns
 *     and "skip hidden" as in folder synchronization).
 *  2. Each file is compared with the newest COMPLETE version by size and
 *     modification time (and SHA-256 with "compare contents"). Unchanged files
 *     are hard links to the previous version's copy (or reuse its stored object
 *     on drives without hard links); new and changed files are copied to a
 *     temporary file (fsync, size check, optional read-back SHA-256), get the
 *     source's modification time and are renamed into place.
 *  3. The manifest is written last, atomically: only then is the version complete.
 *  4. Retention removes complete versions the policy no longer keeps (only
 *     inside the store, each removal noted in the result and the log), and
 *     unreferenced objects in object mode.
 *
 * Stopping or failing removes the unfinished version folder of this run, so no
 * version without a manifest is left behind by a cancel (a crash leaves an
 * incomplete one, which is never used).
 */

export const BackupRunParams = z.object({ jobId: z.string().min(1).max(128), scheduled: z.boolean().optional() });

export interface BackupRunnerDeps {
  getJob(id: string): BackupJob | undefined;
  markRunning(rec: OperationRecord): void;
  now?: () => number;
  /** Storage mode for a store (default: hard links when the drive supports them). Tests force 'objects'. */
  storageFor?: (store: string) => Promise<StorageMode>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Called when the run ends (any state), with what it made and removed. */
  onRunEnd?: (jobId: string, info: RunInfo) => void;
}

export interface RunInfo {
  operationId: string;
  version?: string;
  complete: boolean;
  stats?: VersionStats;
  removed: string[];
  objectsRemoved: number;
  problems: number;
  storage?: StorageMode;
  error?: string;
}

interface Planned {
  e: ScanEntry;
  label: string;
  p: string;
  abs: string;
  prev?: ManifestEntry;
}

const emptyStats = (): VersionStats => ({
  files: 0, directories: 0, symlinks: 0, bytes: 0, newFiles: 0, changedFiles: 0, unchangedFiles: 0, removedFiles: 0, copiedBytes: 0, sharedFiles: 0, errors: 0, skipped: 0,
});

/** SHA-256 of a file, waiting at the gate between chunks. */
export async function hashFile(p: string, ctx: Pick<RunContext, 'gate' | 'signal'>, onBytes?: (n: number) => void): Promise<string> {
  const h = crypto.createHash('sha256');
  const t = new Transform({
    transform(chunk: Buffer, _e, cb) {
      ctx.gate().then(() => {
        h.update(chunk);
        onBytes?.(chunk.length);
        cb();
      }, cb);
    },
  });
  await pipeline(fs.createReadStream(p, { highWaterMark: 1024 * 1024 }), t, { signal: ctx.signal }).catch((err) => {
    if (ctx.signal.aborted) throw makeError('cancelled', 'backup.hash');
    throw err;
  });
  return h.digest('hex');
}

/** Refuse a destination inside a source, or a source inside the destination (real paths). */
export async function checkOverlap(sources: string[], destination: string, operation: string): Promise<void> {
  const dest = await realpathOr(destination);
  for (const s of sources) {
    const src = await realpathOr(s);
    if (isWithin(src, dest)) throw makeError('validation', operation, { message: `The destination is inside the source “${s}”. Choose a destination outside every source folder.`, target: destination });
    if (isWithin(dest, src)) throw makeError('validation', operation, { message: `The source “${s}” is inside the destination. Choose a destination that does not contain a source folder.`, target: s });
  }
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (i !== j && isWithin(await realpathOr(sources[i]!), await realpathOr(sources[j]!))) {
        throw makeError('validation', operation, { message: `“${sources[j]}” is inside “${sources[i]}”. Choose source folders that do not contain each other.`, target: sources[j] });
      }
    }
  }
}

export function makeBackupRunner(deps: BackupRunnerDeps): ExternalRunner {
  const now = deps.now ?? Date.now;
  return async (rec, req, ctx, helpers) => {
    const parsed = BackupRunParams.safeParse(req.params ?? {});
    if (!parsed.success) throw makeError('validation', 'backup.run', { message: 'The backup request is not valid.' });
    const job = deps.getJob(parsed.data.jobId);
    if (!job) throw makeError('not_found', 'backup.run', { message: 'This backup job no longer exists.' });
    rec.itemResults = true;
    rec.undo = { kind: 'none', reason: 'A backup version is not undone. Older versions are removed only by the retention you chose for this job.' };
    const info: RunInfo = { operationId: rec.id, complete: false, removed: [], objectsRemoved: 0, problems: 0 };
    let versionDir: string | undefined;
    try {
      await runBackup(job, rec, ctx, helpers, deps, now, info, (d) => (versionDir = d));
    } catch (err) {
      // Remove the unfinished version of THIS run (inside the store; its name was created by this run).
      if (versionDir && !info.complete) {
        const name = path.basename(versionDir);
        await removeVersionDir(job.storePath, name).then(
          () => {
            rec.notes = [...(rec.notes ?? []), `The unfinished version ${name} was removed; earlier versions are unchanged.`];
            deps.log?.('backup.partial_removed', { job: job.id, version: name });
          },
          (e) => {
            rec.notes = [...(rec.notes ?? []), `The unfinished version ${name} could not be removed (${(e as Error).message}). It has no manifest, so it is never used.`];
          },
        );
        info.version = undefined;
      }
      info.error = toOrbisError(err, 'backup.run').message;
      throw err;
    } finally {
      deps.onRunEnd?.(job.id, info);
    }
  };
}

async function runBackup(
  job: BackupJob,
  rec: OperationRecord,
  ctx: RunContext,
  helpers: RunnerHelpers,
  deps: BackupRunnerDeps,
  now: () => number,
  info: RunInfo,
  setVersionDir: (d: string) => void,
): Promise<void> {
  const store = job.storePath;
  const sources = job.sources;
  for (const s of sources) {
    const st = await fsp.stat(s).catch(() => undefined);
    if (!st?.isDirectory()) throw makeError('not_found', 'backup.run', { message: `The source folder ${s} is not available.`, target: s });
  }
  await checkOverlap(sources, path.dirname(store), 'backup.run');
  await checkOverlap(sources, store, 'backup.run');
  await ensureStore(store, job, now());
  const storage: StorageMode = deps.storageFor ? await deps.storageFor(store) : (await probeHardLinks(store)) ? 'hardlink' : 'objects';
  info.storage = storage;

  // Base: the newest complete version.
  const versions = await listVersions(store, job.id);
  const base = versions.find((v) => v.complete)?.manifest;
  const prevByPath = new Map<string, ManifestEntry>();
  if (base) for (const e of base.entries) prevByPath.set(e.p.normalize('NFC'), e);

  // ---------------- scan
  const labels = sourceLabels(sources);
  const filter = makeFilter(job.options.include, job.options.exclude, false);
  const checkpoint = () => ctx.gate();
  const planned: Planned[] = [];
  const dirs: Array<{ p: string; e: ScanEntry }> = [];
  const links: Planned[] = [];
  const problems: Array<{ path: string; message: string }> = [];
  const stats = emptyStats();
  rec.progress = { completedItems: 0, completedBytes: 0, currentItem: 'Reading the source folders…' };
  for (let i = 0; i < sources.length; i++) {
    const root = await fsp.realpath(sources[i]!);
    const label = labels[i]!;
    const scan = await scanSide(root, { filter, caseInsensitive: false, skipHidden: job.options.skipHidden, symlinks: 'copy-as-link', checkpoint });
    for (const e of scan.errors) problems.push({ path: e.slice(0, e.lastIndexOf(':')) || e, message: e.slice(e.lastIndexOf(':') + 1).trim() || 'unreadable' });
    stats.skipped += scan.special;
    dirs.push({ p: label, e: { key: '', rel: '', name: label, kind: 'directory', size: 0, mtimeMs: (await fsp.stat(root)).mtimeMs } });
    for (const e of scan.entries.values()) {
      if (e.name.startsWith(PART_PREFIX)) continue;
      const p = `${label}/${e.rel}`;
      const item: Planned = { e, label, p, abs: path.join(root, ...e.rel.split('/')), prev: prevByPath.get(p.normalize('NFC')) };
      if (e.kind === 'directory') dirs.push({ p, e });
      else if (e.kind === 'symlink') links.push(item);
      else planned.push(item);
    }
  }
  // Folders only searched for included items still hold included files: make sure their parents exist.
  dirs.sort((a, b) => a.p.split('/').length - b.p.split('/').length || (a.p < b.p ? -1 : 1));
  planned.sort((a, b) => (a.p < b.p ? -1 : 1));
  const unchanged = (it: Planned) => !!it.prev && it.prev.k === 'f' && it.prev.s === it.e.size && it.prev.m === it.e.mtimeMs;
  const toCopyBytes = planned.reduce((n, it) => n + (job.options.compareContents || !unchanged(it) ? it.e.size : 0), 0); // compare contents: every file is read once
  rec.progress = { totalItems: planned.length + links.length + dirs.length, totalBytes: toCopyBytes, completedItems: 0, completedBytes: 0 };
  deps.markRunning(rec);

  // ---------------- version folder
  const startedMs = now();
  let name = versionName(startedMs);
  for (let n = 2; ; n++) {
    try {
      await fsp.mkdir(path.join(store, name));
      break;
    } catch (err) {
      if ((err as { code?: string }).code !== 'EEXIST' || n > 99) throw err;
      name = `${versionName(startedMs)}-${n}`;
    }
  }
  const vdir = path.join(store, name);
  setVersionDir(vdir);
  info.version = name;
  if (storage === 'objects') await fsp.mkdir(path.join(store, OBJECTS), { recursive: true });

  const entries: ManifestEntry[] = [];
  const made = new Set<string>();
  const ensureDir = async (p: string) => {
    if (storage !== 'hardlink' || made.has(p)) return;
    await fsp.mkdir(treePath(store, name, p), { recursive: true });
    made.add(p);
  };
  for (const d of dirs) {
    await ctx.gate();
    await ensureDir(d.p);
    entries.push({ p: d.p, k: 'd', m: d.e.mtimeMs });
    stats.directories++;
    helpers.tick(0, 1);
  }
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'));

  // ---------------- files
  for (const it of planned) {
    await ctx.gate();
    const { e, p } = it;
    try {
      await ensureDir(parentOf(p));
      let same = unchanged(it);
      let hashed = false;
      if (same && job.options.compareContents) {
        const sha = await hashFile(it.abs, ctx, (n) => helpers.tick(n, 0, e.name));
        hashed = true;
        same = !!it.prev!.h && sha === it.prev!.h;
      }
      let entry: ManifestEntry | undefined;
      if (same && base) entry = await reuse(store, base, storage, name, it);
      if (entry) {
        stats.sharedFiles++;
      } else {
        entry = await copyIn(store, storage, name, it, job.options.verify, ctx, helpers, !hashed);
        entry.x = same ? 'u' : it.prev?.k === 'f' ? 'c' : 'n';
        stats.copiedBytes += entry.s ?? 0;
      }
      if (entry.x === 'u') stats.unchangedFiles++;
      else if (entry.x === 'c') stats.changedFiles++;
      else stats.newFiles++;
      entries.push(entry);
      stats.files++;
      stats.bytes += entry.s ?? 0;
    } catch (err) {
      const shape = toOrbisError(err, 'backup.copy', it.abs, 'no');
      if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
      if (shape.category === 'no_space') throw err; // the destination is full: stop rather than make a version with holes
      problems.push({ path: it.abs, message: shape.message });
      rec.results.push({ source: it.abs, status: 'failed', error: shape });
    }
    helpers.tick(0, 1);
  }
  for (const it of links) {
    await ctx.gate();
    try {
      if (storage === 'hardlink') {
        await ensureDir(parentOf(it.p));
        await fsp.symlink(it.e.linkTarget ?? '', treePath(store, name, it.p));
      }
      entries.push({ p: it.p, k: 'l', m: it.e.mtimeMs, t: it.e.linkTarget ?? '' });
      stats.symlinks++;
    } catch (err) {
      const shape = toOrbisError(err, 'backup.link', it.abs, 'no');
      if (shape.category === 'cancelled') throw err;
      problems.push({ path: it.abs, message: shape.message });
      rec.results.push({ source: it.abs, status: 'failed', error: shape });
    }
    helpers.tick(0, 1);
  }
  const now2 = new Set(entries.filter((x) => x.k === 'f').map((x) => x.p.normalize('NFC')));
  if (base) stats.removedFiles = base.entries.filter((x) => x.k === 'f' && !now2.has(x.p.normalize('NFC'))).length;
  stats.errors = problems.length;

  // ---------------- manifest (last, atomic): the version is complete from here on
  await ctx.gate();
  const manifest: VersionManifest = {
    format: 'orbis-backup-manifest', formatVersion: 1, jobId: job.id, jobName: job.name, version: name,
    startedMs, finishedMs: now(), storage, base: base?.version,
    sources: sources.map((s, i) => ({ label: labels[i]!, path: s })),
    options: job.options, stats, problems: problems.slice(0, 200), entries,
  };
  await writeFileAtomic(path.join(vdir, MANIFEST), JSON.stringify(manifest));
  await fsyncDir(store);
  info.complete = true;
  info.stats = stats;
  info.problems = problems.length;
  for (let i = 0; i < sources.length; i++) rec.results.push({ source: sources[i]!, destination: path.join(vdir, labels[i]!), status: 'done' });
  deps.log?.('backup.version', { job: job.id, version: name, storage, files: stats.files, copied: stats.newFiles + stats.changedFiles, shared: stats.sharedFiles, problems: problems.length });
  const notes = [
    `Version ${name}: ${stats.files} file${stats.files === 1 ? '' : 's'} (${stats.newFiles} new, ${stats.changedFiles} changed, ${stats.unchangedFiles} unchanged${stats.removedFiles ? `, ${stats.removedFiles} no longer in the sources` : ''}).`,
    !base
      ? 'This is the first version, so every file was copied.'
      : storage === 'hardlink'
        ? 'Unchanged files are hard links to the previous version: they take no extra space.'
        : 'Unchanged files share the contents already stored in the objects folder.',
  ];
  if (storage === 'objects') notes.push('This drive does not support hard links, so file contents are stored once in the store’s objects folder (by SHA-256) and the version folder holds only its manifest.');
  if (problems.length) notes.push(`${problems.length} item(s) could not be read and are not in this version.`);
  if (stats.skipped) notes.push(`${stats.skipped} special file(s) (devices, sockets, pipes) are never backed up.`);

  // ---------------- retention (complete versions only; never this one)
  const all = await listVersions(store, job.id);
  const complete = all.filter((v) => v.complete);
  const decision = planRetention(complete.map((v) => ({ name: v.name, startedMs: v.startedMs })), job.retention, now());
  for (const old of decision.remove) {
    if (old === name) continue;
    await removeVersionDir(store, old);
    info.removed.push(old);
    deps.log?.('backup.retention_removed', { job: job.id, version: old });
  }
  if (info.removed.length) notes.push(`Retention removed ${info.removed.length} older version(s): ${info.removed.join(', ')}.`);
  // Object mode: contents no complete version uses any more (removed versions, stopped runs).
  const gc = await collectObjects(store, (await listVersions(store, job.id)).filter((v) => v.complete).map((v) => v.manifest!));
  info.objectsRemoved = gc;
  if (gc) {
    notes.push(`${gc} stored object(s) no longer used by any version were removed.`);
    deps.log?.('backup.objects_removed', { job: job.id, count: gc });
  }
  const incomplete = all.filter((v) => !v.complete).length;
  if (incomplete) notes.push(`${incomplete} incomplete version(s) from interrupted runs are in the store; they are never used.`);
  rec.notes = [...(rec.notes ?? []), ...notes];
}

/** Unchanged file: share the previous version's copy (hard link) or object. Undefined when that copy is gone or different. */
async function reuse(store: string, base: VersionManifest, storage: StorageMode, version: string, it: Planned): Promise<ManifestEntry | undefined> {
  const prev = it.prev!;
  const entry: ManifestEntry = { p: it.p, k: 'f', s: it.e.size, m: it.e.mtimeMs, h: prev.h, mo: prev.mo, x: 'u' };
  if (storage === 'objects') {
    if (!prev.h) return undefined;
    const st = await fsp.lstat(objectPath(store, prev.h)).catch(() => undefined);
    return st?.isFile() && st.size === prev.s ? entry : undefined;
  }
  if (base.storage !== 'hardlink') return undefined;
  const from = treePath(store, base.version, prev.p);
  const st = await fsp.lstat(from).catch(() => undefined);
  if (!st?.isFile() || st.size !== prev.s || Math.abs(st.mtimeMs - prev.m) > 1) return undefined; // the stored copy was changed: copy again
  try {
    await fsp.link(from, treePath(store, version, it.p));
    return entry;
  } catch {
    return undefined; // too many links, or links not possible after all: copy instead
  }
}

/** Copy a source file into the version (tree) or the object store, atomically, hashing on the way. */
async function copyIn(store: string, storage: StorageMode, version: string, it: Planned, verify: boolean, ctx: RunContext, helpers: RunnerHelpers, countBytes = true): Promise<ManifestEntry> {
  const before = await fsp.lstat(it.abs);
  if (!before.isFile()) throw makeError('validation', 'backup.copy', { message: 'The item is no longer a file.', target: it.abs });
  const dir = storage === 'hardlink' ? path.dirname(treePath(store, version, it.p)) : path.join(store, OBJECTS);
  const tmp = path.join(dir, `${PART_PREFIX}${crypto.randomUUID()}`);
  helpers.temp(tmp);
  const h = crypto.createHash('sha256');
  let n = 0;
  const t = new Transform({
    transform(chunk: Buffer, _e, cb) {
      ctx.gate().then(() => {
        h.update(chunk);
        n += chunk.length;
        helpers.tick(countBytes ? chunk.length : 0, 0, it.e.name);
        cb(null, chunk);
      }, cb);
    },
  });
  try {
    await pipeline(fs.createReadStream(it.abs, { highWaterMark: 1024 * 1024 }), t, fs.createWriteStream(tmp, { flags: 'wx', mode: (before.mode & 0o777) | 0o600 }), { signal: ctx.signal });
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    helpers.committed(tmp);
    if (ctx.signal.aborted) throw makeError('cancelled', 'backup.copy', { target: it.abs });
    throw err;
  }
  const sha = h.digest('hex');
  try {
    const fh = await fsp.open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const after = await fsp.lstat(it.abs);
    const written = (await fsp.stat(tmp)).size;
    if (written !== n || after.size !== before.size || after.mtimeMs !== before.mtimeMs || n !== before.size) {
      throw makeError('busy', 'backup.copy', { message: 'The file changed while it was being copied; it is not in this version. It will be copied on the next run.', target: it.abs, retryable: true });
    }
    if (verify) {
      const again = await hashFile(tmp, ctx);
      if (again !== sha) throw makeError('io', 'backup.verify', { message: 'The copy did not match the source when read back (SHA-256).', target: it.abs, retryable: true });
    }
    await fsp.utimes(tmp, before.atimeMs / 1000, before.mtimeMs / 1000);
    if (storage === 'hardlink') {
      await fsp.rename(tmp, treePath(store, version, it.p));
    } else {
      const obj = objectPath(store, sha);
      const have = await fsp.lstat(obj).catch(() => undefined);
      if (have?.isFile() && have.size === n) await fsp.rm(tmp, { force: true }); // identical contents already stored
      else {
        await fsp.mkdir(path.dirname(obj), { recursive: true });
        await fsp.rename(tmp, obj);
      }
    }
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    helpers.committed(tmp);
    throw err;
  }
  helpers.committed(tmp);
  return { p: it.p, k: 'f', s: n, m: before.mtimeMs, h: sha, mo: before.mode & 0o7777 };
}

/** Object mode: remove stored objects that no complete version references. Returns how many were removed. */
export async function collectObjects(store: string, manifests: VersionManifest[]): Promise<number> {
  const root = path.join(store, OBJECTS);
  const subdirs = await fsp.readdir(root).catch(() => [] as string[]);
  if (!subdirs.length) return 0;
  const used = new Set<string>();
  for (const m of manifests) if (m.storage === 'objects') for (const e of m.entries) if (e.k === 'f' && e.h) used.add(e.h);
  let removed = 0;
  for (const d of subdirs) {
    if (!/^[0-9a-f]{2}$/.test(d)) continue;
    for (const f of await fsp.readdir(path.join(root, d)).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{64}$/.test(f) || f.slice(0, 2) !== d || used.has(f)) continue;
      await fsp.rm(path.join(root, d, f), { force: true });
      removed++;
    }
  }
  return removed;
}
