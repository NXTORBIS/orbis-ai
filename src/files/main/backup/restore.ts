import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { RestoreRequestSchema, type BackupJob, type ManifestEntry, type RestoreRequest, type VerifyResult, type VersionManifest } from '../../shared/backup';
import type { ConflictDecision } from '../../shared/operations';
import type { ExternalRunner, PlatformOps } from '../ops/OperationManager';
import { isWithin, uniqueName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import type { JobGate } from '../jobs/PauseGate';
import { dataPath, PART_PREFIX, readManifest } from './format';

/**
 * Restoring from a backup version ('backup-restore' operation) and checking a
 * version against its manifest (verify, a read-only background job).
 *
 * Restore never overwrites silently: an item in the way is a conflict the user
 * decides (keep both, skip, or replace — the replaced item goes to the Trash
 * first, and only when the Trash is available). Every copy is written to a
 * temporary file, checked against the manifest's size and SHA-256, given the
 * recorded modification time and permissions, then committed with link() so
 * nothing that appeared meanwhile is overwritten.
 */

export const RestoreParams = RestoreRequestSchema;
export type { RestoreRequest };

export interface RestoreDeps {
  getJob(id: string): BackupJob | undefined;
  platform: PlatformOps;
  markRunning(rec: import('../../shared/operations').OperationRecord): void;
  onChanged?(paths: string[]): void;
  onRunEnd?(jobId: string, info: { version: string; restored: number; skipped: number; failed: number; target: string; state?: string }): void;
}

interface Planned {
  e: ManifestEntry;
  target: string;
}

/** Entries of `items` (each with everything inside), and where each lands. */
export function planRestore(m: VersionManifest, req: RestoreRequest): { planned: Planned[]; roots: string[] } {
  const byLabel = new Map(m.sources.map((s) => [s.label, s.path]));
  const planned: Planned[] = [];
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const item of req.items) {
    const matched = m.entries.filter((e) => e.p === item || e.p.startsWith(`${item}/`));
    if (!matched.length) throw makeError('not_found', 'backup.restore', { message: `“${item}” is not in version ${m.version}.`, target: item });
    const label = item.split('/')[0]!;
    let targetOf: (p: string) => string;
    if (req.target.kind === 'original') {
      const src = byLabel.get(label);
      if (!src) throw makeError('validation', 'backup.restore', { message: `Version ${m.version} does not say where “${label}” was backed up from.`, target: item });
      targetOf = (p) => path.join(src, ...p.split('/').slice(1));
      roots.push(item.includes('/') ? path.dirname(targetOf(item)) : src);
    } else {
      const dest = path.resolve(req.target.path);
      const parent = item.includes('/') ? item.slice(0, item.lastIndexOf('/')) : '';
      targetOf = (p) => path.join(dest, ...(parent ? p.slice(parent.length + 1) : p).split('/'));
      roots.push(dest);
    }
    for (const e of matched) {
      if (seen.has(e.p)) continue;
      seen.add(e.p);
      const target = targetOf(e.p);
      const root = req.target.kind === 'original' ? byLabel.get(label)! : path.resolve((req.target as { path: string }).path);
      if (!isWithin(root, target)) throw makeError('invalid_path', 'backup.restore', { message: 'A path in the backup would leave the restore folder.', target: e.p });
      planned.push({ e, target });
    }
  }
  // Folders first (outermost first), then files and links.
  planned.sort((a, b) => (a.e.k === 'd' ? 0 : 1) - (b.e.k === 'd' ? 0 : 1) || a.e.p.split('/').length - b.e.p.split('/').length || (a.e.p < b.e.p ? -1 : 1));
  return { planned, roots: [...new Set(roots)] };
}

export function makeRestoreRunner(deps: RestoreDeps): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const parsed = RestoreParams.safeParse(req.params ?? {});
    if (!parsed.success) throw makeError('validation', 'backup.restore', { message: 'The restore request is not valid.' });
    const p = parsed.data;
    const job = deps.getJob(p.jobId);
    if (!job) throw makeError('not_found', 'backup.restore', { message: 'This backup job no longer exists.' });
    const { manifest, problem } = await readManifest(job.storePath, p.version, job.id);
    if (!manifest) throw makeError('validation', 'backup.restore', { message: `Version ${p.version} cannot be used: ${problem}` });
    const { planned, roots } = planRestore(manifest, p);
    rec.itemResults = true;
    rec.undo = { kind: 'none', reason: 'A restore is not undone automatically. Items it replaced are in the Trash.' };
    rec.progress = { totalItems: planned.length, totalBytes: planned.reduce((n, x) => n + (x.e.k === 'f' ? x.e.s ?? 0 : 0), 0), completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    if (p.target.kind === 'folder') {
      const st = await fsp.stat(p.target.path).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'backup.restore', { message: 'The folder to restore into does not exist.', target: p.target.path });
    }
    const allowed: Array<'skip' | 'keep-both' | 'replace'> = deps.platform.trashSupported ? ['keep-both', 'skip', 'replace'] : ['keep-both', 'skip'];
    /** Targets of folders that could not be made: nothing is restored below them. */
    const blocked: string[] = [];
    /** Folders restored under another name (keep both): their contents follow. */
    const renamed: Array<{ from: string; to: string }> = [];
    const changed: string[] = [];
    let restored = 0;
    const mapTarget = (t: string) => {
      for (const r of renamed) if (t === r.from || isWithin(r.from, t)) return path.join(r.to, path.relative(r.from, t));
      return t;
    };
    const ask = async (src: ManifestEntry, target: string): Promise<ConflictDecision['action']> => {
      const st = await fsp.lstat(target);
      return helpers.ask({
        source: `${p.version}/${src.p}`, destination: target,
        sourceKind: src.k === 'd' ? 'directory' : src.k === 'l' ? 'symlink' : 'file',
        destinationKind: st.isDirectory() ? 'directory' : st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other',
        sourceSize: src.s, destinationSize: st.isFile() ? st.size : undefined, sourceModifiedMs: src.m, destinationModifiedMs: st.mtimeMs,
        suggestedName: await uniqueName(path.dirname(target), path.basename(target), exists), remaining: planned.length - rec.results.length,
        allowed: src.k === 'd' ? ['keep-both', 'skip'] : allowed,
      });
    };
    let i = 0;
    try {
      for (; i < planned.length; i++) {
        await ctx.gate();
        const { e } = planned[i]!;
        let target = mapTarget(planned[i]!.target);
        const label = `${p.version}/${e.p}`;
        if (blocked.some((b) => isWithin(b, target))) {
          rec.results.push({ source: label, destination: target, status: 'skipped', error: { category: 'validation', operation: 'backup.restore', message: 'Its folder was not restored.', dataChanged: 'no', retryable: false, target } });
          helpers.tick(e.k === 'f' ? e.s ?? 0 : 0, 1);
          continue;
        }
        try {
          if (e.k === 'd') {
            const st = await fsp.lstat(target).catch(() => undefined);
            if (st?.isDirectory()) {
              helpers.tick(0, 1);
              continue; // merged into the existing folder; its items are checked one by one
            }
            if (st) {
              const action = await ask(e, target);
              if (action === 'skip') {
                blocked.push(target);
                rec.results.push({ source: label, destination: target, status: 'skipped' });
                helpers.tick(0, 1);
                continue;
              }
              const to = path.join(path.dirname(target), await uniqueName(path.dirname(target), path.basename(target), exists));
              renamed.push({ from: target, to });
              target = to;
            }
            await fsp.mkdir(target);
            changed.push(target);
            helpers.tick(0, 1);
            continue;
          }
          let replace = false;
          const there = await fsp.lstat(target).catch(() => undefined);
          if (there) {
            const action = await ask(e, target);
            if (action === 'skip' || action === 'merge') {
              rec.results.push({ source: label, destination: target, status: 'skipped' });
              helpers.tick(e.k === 'f' ? e.s ?? 0 : 0, 1);
              continue;
            }
            if (action === 'keep-both') target = path.join(path.dirname(target), await uniqueName(path.dirname(target), path.basename(target), exists));
            else if (action === 'replace' && deps.platform.trashSupported) replace = true;
            else throw makeError('validation', 'backup.restore', { message: 'That choice is not available for restoring.' });
          }
          await fsp.mkdir(path.dirname(target), { recursive: true });
          if (e.k === 'l') {
            if (replace) await deps.platform.trash(target);
            await fsp.symlink(e.t ?? '', target);
          } else {
            await restoreFile(job.storePath, manifest, e, target, replace, ctx, helpers, deps.platform);
          }
          changed.push(target);
          restored++;
          rec.results.push({ source: label, destination: target, status: 'done' });
        } catch (err) {
          const shape = toOrbisError(err, 'backup.restore', target, 'no');
          if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
          if (e.k === 'd') blocked.push(target);
          rec.results.push({ source: label, destination: target, status: 'failed', error: shape });
        }
        helpers.tick(0, 1);
      }
    } catch (err) {
      for (let j = i; j < planned.length; j++) if (planned[j]!.e.k !== 'd') rec.results.push({ source: `${p.version}/${planned[j]!.e.p}`, status: 'cancelled' });
      throw err;
    } finally {
      deps.onChanged?.(changed);
      const s = { skipped: rec.results.filter((r) => r.status === 'skipped').length, failed: rec.results.filter((r) => r.status === 'failed').length };
      rec.notes = [...(rec.notes ?? []), `Restored ${restored} item(s) from version ${p.version} into ${roots.join(', ')}.${s.skipped ? ` ${s.skipped} skipped.` : ''}${s.failed ? ` ${s.failed} failed.` : ''}`];
      deps.onRunEnd?.(job.id, { version: p.version, restored, skipped: s.skipped, failed: s.failed, target: roots.join(', ') });
    }
  };
}

async function restoreFile(store: string, m: VersionManifest, e: ManifestEntry, target: string, replace: boolean, ctx: import('../ops/OperationManager').RunContext, helpers: import('../ops/OperationManager').RunnerHelpers, platform: PlatformOps): Promise<void> {
  const from = dataPath(store, m, e);
  const st = await fsp.lstat(from).catch(() => undefined);
  if (!st?.isFile()) throw makeError('not_found', 'backup.restore', { message: 'The backup copy of this file is missing.', target: e.p });
  if (st.size !== e.s) throw makeError('io', 'backup.restore', { message: 'The backup copy of this file is damaged (its size differs from the manifest). Nothing was written.', target: e.p });
  const tmp = path.join(path.dirname(target), `${PART_PREFIX}${crypto.randomUUID()}`);
  helpers.temp(tmp);
  const h = crypto.createHash('sha256');
  const t = new Transform({
    transform(chunk: Buffer, _e, cb) {
      ctx.gate().then(() => {
        h.update(chunk);
        helpers.tick(chunk.length, 0, path.basename(target));
        cb(null, chunk);
      }, cb);
    },
  });
  try {
    await pipeline(fs.createReadStream(from, { highWaterMark: 1024 * 1024 }), t, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }), { signal: ctx.signal });
    const fh = await fsp.open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (e.h && h.digest('hex') !== e.h) throw makeError('io', 'backup.restore', { message: 'The backup copy of this file is damaged (its SHA-256 differs from the manifest). Nothing was written.', target: e.p });
    if ((await fsp.stat(tmp)).size !== e.s) throw makeError('io', 'backup.restore', { message: 'The restored copy has the wrong size. Nothing was written.', target: e.p });
    await fsp.chmod(tmp, (e.mo ?? 0o644) & 0o7777).catch(() => undefined);
    await fsp.utimes(tmp, e.m / 1000, e.m / 1000);
    if (replace) {
      await platform.trash(target); // the version in the way goes to the Trash, never overwritten
    }
    try {
      await fsp.link(tmp, target); // never overwrites an item that appeared meanwhile
      await fsp.unlink(tmp);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EEXIST') throw new OrbisError({ category: 'already_exists', operation: 'backup.restore', message: `“${path.basename(target)}” appeared while restoring and was not overwritten.`, target, dataChanged: 'no', retryable: true });
      if (await exists(target)) throw makeError('already_exists', 'backup.restore', { target });
      await fsp.rename(tmp, target);
    }
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    helpers.committed(tmp);
    if (ctx.signal.aborted) throw makeError('cancelled', 'backup.restore');
    throw err;
  }
  helpers.committed(tmp);
}

/** Check every file of a complete version against its manifest (size, and SHA-256 when recorded). Read-only. */
export async function verifyVersion(
  store: string,
  m: VersionManifest,
  signal: AbortSignal,
  gate?: JobGate,
  onProgress?: (p: { done: number; total: number; bytes: number; totalBytes: number }) => void,
): Promise<VerifyResult> {
  const t0 = Date.now();
  const files = m.entries.filter((e) => e.k === 'f');
  const totalBytes = files.reduce((n, e) => n + (e.s ?? 0), 0);
  const res: VerifyResult = { version: m.version, checked: 0, ok: 0, mismatched: [], missing: [], sizeOnly: 0, durationMs: 0 };
  let bytes = 0;
  for (const e of files) {
    if (gate?.isPaused) await gate.wait();
    if (signal.aborted) throw makeError('cancelled', 'backup.verify');
    res.checked++;
    let from: string;
    try {
      from = dataPath(store, m, e);
    } catch {
      res.missing.push(e.p);
      continue;
    }
    const st = await fsp.lstat(from).catch(() => undefined);
    if (!st?.isFile()) {
      res.missing.push(e.p);
      continue;
    }
    if (st.size !== e.s) {
      res.mismatched.push(e.p);
      continue;
    }
    if (!e.h) {
      res.sizeOnly++;
      res.ok++;
      continue;
    }
    const h = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(from, { highWaterMark: 1024 * 1024 }), new Transform({
      transform(chunk: Buffer, _e, cb) {
        const go = () => {
          h.update(chunk);
          bytes += chunk.length;
          cb();
        };
        if (gate?.isPaused) gate.wait().then(go, cb);
        else go();
      },
    }), { signal }).catch((err) => {
      if (signal.aborted) throw makeError('cancelled', 'backup.verify');
      throw err;
    });
    if (h.digest('hex') === e.h) res.ok++;
    else res.mismatched.push(e.p);
    if (res.checked % 20 === 0) onProgress?.({ done: res.checked, total: files.length, bytes, totalBytes });
  }
  onProgress?.({ done: res.checked, total: files.length, bytes, totalBytes });
  res.durationMs = Date.now() - t0;
  return res;
}
