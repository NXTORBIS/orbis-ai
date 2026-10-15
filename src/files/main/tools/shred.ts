import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError, toOrbisError } from '../../shared/errors';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import { LINUX_FS_TYPES, ShredParamsSchema, type ShredFsInfo, type ShredInfo } from '../../shared/powerTools';
import type { ExternalRunner, RunContext } from '../ops/OperationManager';
import { isProtectedPath } from '../ops/OperationManager';
import { isWithin } from '../fs/paths';

/**
 * Secure delete ("shred"). Each regular file is overwritten in place with
 * random data (one pass, or three), flushed to the drive with fsync after
 * every pass, renamed to a random name, truncated to zero and unlinked.
 * Folders are handled recursively, deepest first; links are never followed
 * (the link itself is removed) and device files, sockets and pipes are removed
 * without being written to. Files with other hard links are left alone: their
 * contents are shared with the other names.
 *
 * Cancelling stops after the file being overwritten (a half-overwritten file
 * would be both damaged and still there); the result lists exactly which files
 * were destroyed and which were not touched.
 *
 * Honesty: overwriting in place does not reach old copies on SSDs (wear
 * levelling), on copy-on-write file systems (btrfs, ZFS, APFS…), in snapshots,
 * journals, backups or cloud copies. `shredInfo` reports what it can detect.
 */

const CHUNK = 1024 * 1024;
const MAX_INFO_ENTRIES = 200_000;

/** Folders the shred refuses to touch: the Trash and Orbis Files' private scratch space. */
export function shredRefusal(p: string, extraRoots: string[] = []): string | undefined {
  if (isProtectedPath(p)) return 'Orbis Files will not shred a drive root or your home folder.';
  const dataHome = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(os.homedir(), '.local', 'share');
  const trashRoots = [path.join(dataHome, 'Trash'), ...extraRoots];
  if (trashRoots.some((r) => isWithin(r, p))) return 'Items in the Trash or in Orbis Files’ temporary folders cannot be shredded here.';
  if (/[\\/]\.Trash(-\d+)?([\\/]|$)/.test(p)) return 'Items in a Trash folder cannot be shredded here.';
  return undefined;
}

export function validateShredRequest(extraRoots: string[] = []) {
  return (req: OperationRequest): void => {
    const p = ShredParamsSchema.safeParse(req.params);
    if (!p.success) throw makeError('validation', 'shred.run', { message: 'Secure delete needs to be confirmed twice in its dialog.' });
    if (!req.sources.length) throw makeError('validation', 'shred.run', { message: 'Nothing to shred.' });
    for (const s of req.sources) {
      const why = shredRefusal(s, extraRoots);
      if (why) throw makeError('permission_denied', 'shred.run', { target: s, message: why });
    }
  };
}

// ------------------------------------------------------------------ file-system information

/** Linux: whether the block device holding `dev` is solid state (/sys/dev/block/MAJ:MIN → queue/rotational). */
async function linuxSolidState(dev: number): Promise<boolean | undefined> {
  // Node's dev_t uses the kernel's new_encode_dev layout.
  const major = ((dev >> 8) & 0xfff) | (Math.floor(dev / 2 ** 32) & ~0xfff);
  const minor = (dev & 0xff) | ((dev >> 12) & ~0xff);
  if (major === 0) return undefined; // anonymous devices (btrfs subvolumes, tmpfs, FUSE…)
  const base = `/sys/dev/block/${major}:${minor}`;
  for (const q of [`${base}/queue/rotational`, `${base}/../queue/rotational`]) {
    const v = await fsp.readFile(q, 'utf8').catch(() => undefined);
    if (v !== undefined) return v.trim() === '0';
  }
  return undefined;
}

/** File-system type and what it means for overwriting in place. */
export async function filesystemInfo(where: string): Promise<ShredFsInfo> {
  const warnings: string[] = [];
  let type = 'unknown';
  let copyOnWrite = false;
  let solidState: boolean | undefined;
  if (process.platform === 'linux') {
    const sf = await fsp.statfs(where).catch(() => undefined);
    const known = sf ? LINUX_FS_TYPES[Number(sf.type)] : undefined;
    type = known?.name ?? (sf ? `unknown (0x${Number(sf.type).toString(16)})` : 'unknown');
    copyOnWrite = !!known?.cow;
    if (known?.cow) warnings.push(`${known.name} is a copy-on-write file system: overwriting writes the random data to NEW blocks, so the old contents usually stay on the drive until they are reused. Shredding does not securely erase them here.`);
    else if (known?.note) warnings.push(known.note);
    if (known?.network) warnings.push(`This is a network share (${known.name}): the server decides where data is written, and it may keep snapshots or versions.`);
    if (known?.name === 'tmpfs') warnings.push('tmpfs lives in memory (and swap); its old contents may remain in swap space.');
    const st = await fsp.stat(where).catch(() => undefined);
    if (st) solidState = await linuxSolidState(st.dev);
    if (known?.name === 'ext2/3/4') warnings.push('ext4 journals metadata (and data with data=journal); copies of small files can remain in the journal.');
  } else if (process.platform === 'darwin') {
    type = 'APFS or HFS+ (not detected)';
    copyOnWrite = true;
    warnings.push('APFS, the macOS default, is copy-on-write and usually on an SSD: overwriting does not reach the old blocks, and Time Machine local snapshots may keep the file.');
  } else if (process.platform === 'win32') {
    type = 'NTFS or other (not detected)';
    warnings.push('On Windows, Volume Shadow Copies (restore points), OneDrive and SSD wear levelling can keep old contents.');
  }
  if (solidState) warnings.push('This drive is an SSD or flash memory: wear levelling writes new data to other cells, so the old contents can remain until the drive erases them (use the drive’s own secure erase or full-disk encryption instead).');
  return { where, type, copyOnWrite, solidState, warnings };
}

/** Counts and file-system warnings for the items (a background job). Links are counted, never followed. */
export async function shredInfo(paths: string[], opts: { signal?: AbortSignal; wait?: () => Promise<void>; onProgress?: (n: number) => void } = {}): Promise<ShredInfo> {
  const info: ShredInfo = { items: [], files: 0, folders: 0, links: 0, others: 0, bytes: 0, hardLinked: 0, filesystems: [], truncated: false };
  const devs = new Map<number, string>();
  let seen = 0;
  for (const p of paths) {
    const st = await fsp.lstat(p).catch(() => undefined);
    if (!st) throw makeError('not_found', 'shred.info', { target: p, message: `${path.basename(p)} no longer exists.` });
    const kind = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
    if (!devs.has(st.dev)) devs.set(st.dev, kind === 'directory' ? p : path.dirname(p));
    const stack = [p];
    let size = 0;
    while (stack.length) {
      if (opts.signal?.aborted) throw makeError('cancelled', 'shred.info');
      await opts.wait?.();
      const q = stack.pop()!;
      const s = q === p ? st : await fsp.lstat(q).catch(() => undefined);
      if (!s) continue;
      if (++seen > MAX_INFO_ENTRIES) {
        info.truncated = true;
        break;
      }
      if (seen % 500 === 0) opts.onProgress?.(seen);
      if (s.isSymbolicLink()) info.links++;
      else if (s.isFile()) {
        info.files++;
        info.bytes += s.size;
        size += s.size;
        if (s.nlink > 1) info.hardLinked++;
      } else if (s.isDirectory()) {
        info.folders++;
        if (!devs.has(s.dev)) devs.set(s.dev, q);
        for (const c of await fsp.readdir(q).catch(() => [] as string[])) stack.push(path.join(q, c));
      } else info.others++;
    }
    info.items.push({ path: p, kind, size });
  }
  for (const where of devs.values()) info.filesystems.push(await filesystemInfo(where));
  return info;
}

// ------------------------------------------------------------------ the operation

/** Wait while paused, but never stop in the middle of a file (cancel is honoured between files). */
const pauseOnly = (ctx: RunContext) => (ctx.paused ? ctx.gate().catch(() => undefined) : Promise.resolve());

const randomName = (dir: string) => path.join(dir, `.${crypto.randomBytes(9).toString('base64url')}`);

async function fsyncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const fh = await fsp.open(dir, 'r').catch(() => undefined);
  if (!fh) return;
  await fh.sync().catch(() => undefined);
  await fh.close();
}

/**
 * Overwrite a regular file's contents in place, `passes` times, with random
 * data, fsyncing after every pass. The file is opened without following links
 * and must still be the one that was checked (`st`).
 */
export async function overwriteInPlace(p: string, st: fs.Stats, passes: number, ctx: RunContext, tick: (bytes: number) => void): Promise<number> {
  const flags = fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fh = await fsp.open(p, flags).catch(async (err: NodeJS.ErrnoException) => {
    // A read-only file of our own: allow writing (like shred -f), the file is going away anyway.
    if (err.code !== 'EACCES' && err.code !== 'EPERM') throw err;
    await fsp.chmod(p, (st.mode & 0o7777) | 0o200);
    return undefined;
  });
  fh ??= await fsp.open(p, flags);
  let written = 0;
  try {
    const opened = await fh.stat();
    if (opened.ino !== st.ino || opened.dev !== st.dev) throw makeError('busy', 'shred.file', { target: p, dataChanged: 'no', message: 'The file was replaced while it was opened, so it was not touched.' });
    const size = opened.size;
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, size)));
    for (let pass = 0; pass < passes; pass++) {
      let pos = 0;
      while (pos < size) {
        await pauseOnly(ctx);
        const n = Math.min(buf.length, size - pos);
        crypto.randomFillSync(buf, 0, n);
        const r = await fh.write(buf, 0, n, pos);
        pos += r.bytesWritten;
        written += r.bytesWritten;
        tick(r.bytesWritten);
      }
      await fh.sync();
    }
  } finally {
    await fh.close();
  }
  return written;
}

/**
 * Overwrite one regular file `passes` times with random data, fsync each pass,
 * rename it to a random name, truncate and unlink it. Returns the bytes written.
 */
export async function shredFile(p: string, passes: number, ctx: RunContext, tick: (bytes: number) => void): Promise<number> {
  const st = await fsp.lstat(p);
  if (!st.isFile()) throw makeError('unsupported', 'shred.file', { target: p, message: 'Not a regular file.' });
  if (st.nlink > 1) throw makeError('unsupported', 'shred.file', { target: p, dataChanged: 'no', message: `This file has ${st.nlink - 1} other hard link${st.nlink > 2 ? 's' : ''}; overwriting would destroy the contents seen through ${st.nlink > 2 ? 'them' : 'it'} too, so it was left alone.` });
  // The folder must let us remove the file afterwards; check before destroying its contents.
  await fsp.access(path.dirname(p), fs.constants.W_OK | fs.constants.X_OK).catch(() => {
    throw makeError('permission_denied', 'shred.file', { target: p, dataChanged: 'no', message: 'The folder does not allow removing this file, so it was not overwritten.' });
  });
  const written = await overwriteInPlace(p, st, passes, ctx, tick);
  const dir = path.dirname(p);
  let current = randomName(dir);
  try {
    await fsp.rename(p, current);
  } catch {
    current = p; // could not rename (e.g. read-only name on this file system): truncate and unlink under the old name
  }
  await fsyncDir(dir);
  await fsp.truncate(current, 0);
  const t = await fsp.open(current, 'r+').catch(() => undefined);
  if (t) {
    await t.sync().catch(() => undefined);
    await t.close();
  }
  await fsp.unlink(current);
  await fsyncDir(dir);
  return written;
}

/** Operation runner 'shred'. Results list every file, folder and link (itemResults). */
export function makeShredRunner(deps: { markRunning: (rec: OperationRecord) => void; onRemoved?: (p: string) => void; extraRoots?: string[] }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const { passes } = ShredParamsSchema.parse(req.params);
    for (const s of rec.sources) {
      const why = shredRefusal(s, deps.extraRoots);
      if (why) throw makeError('permission_denied', 'shred.run', { target: s, message: why });
    }
    // Plan: every entry, children before their folder; links and special files are removed, never followed or written.
    type Step = { path: string; kind: 'file' | 'dir' | 'link' | 'other'; size: number };
    const plan: Step[] = [];
    rec.itemResults = true;
    for (const src of rec.sources) {
      await ctx.gate();
      const visit = async (p: string): Promise<void> => {
        const st = await fsp.lstat(p).catch((err) => {
          rec.results.push({ source: p, status: 'failed', error: toOrbisError(err, 'shred.run', p, 'no') });
          return undefined;
        });
        if (!st) return;
        if (st.isSymbolicLink()) plan.push({ path: p, kind: 'link', size: 0 });
        else if (st.isDirectory()) {
          const children = await fsp.readdir(p).catch(() => [] as string[]);
          children.sort();
          for (const c of children) await visit(path.join(p, c));
          plan.push({ path: p, kind: 'dir', size: 0 });
        } else if (st.isFile()) plan.push({ path: p, kind: 'file', size: st.size });
        else plan.push({ path: p, kind: 'other', size: 0 });
      };
      await visit(src);
    }
    rec.progress = { totalItems: plan.length, totalBytes: plan.reduce((a, s) => a + s.size * passes, 0), completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    let destroyed = 0;
    let stoppedAt = -1;
    const failedDirs = new Set<string>();
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i]!;
      if (ctx.signal.aborted) {
        stoppedAt = i;
        break;
      }
      await pauseOnly(ctx);
      if (ctx.signal.aborted) {
        stoppedAt = i;
        break;
      }
      const name = path.basename(s.path);
      try {
        if (s.kind === 'file') {
          await shredFile(s.path, passes, ctx, (b) => helpers.tick(b, 0, name));
          destroyed++;
        } else if (s.kind === 'dir') {
          if (failedDirs.has(s.path)) {
            rec.results.push({ source: s.path, status: 'skipped', error: { category: 'directory_not_empty', operation: 'shred.run', message: 'Kept: something inside it was not removed.', target: s.path, dataChanged: 'partial', retryable: true } });
            helpers.tick(0, 1, name);
            continue;
          }
          // Folders are renamed to a random name before removal so their names do not stay in the parent either.
          const tmp = randomName(path.dirname(s.path));
          let at = s.path;
          await fsp.rename(s.path, tmp).then(() => {
            at = tmp;
          }, () => undefined);
          await fsp.rmdir(at).catch(async (err) => {
            if (at !== s.path) await fsp.rename(at, s.path).catch(() => undefined);
            throw err;
          });
        } else {
          // Links and special files: only the directory entry is removed.
          await fsp.unlink(s.path);
        }
        rec.results.push({ source: s.path, status: 'done' });
        deps.onRemoved?.(s.path);
      } catch (err) {
        const shape = toOrbisError(err, 'shred.run', s.path, s.kind === 'file' ? 'unknown' : 'no');
        rec.results.push({ source: s.path, status: s.kind === 'file' && shape.category === 'unsupported' ? 'skipped' : 'failed', error: shape });
        // Its folders cannot be removed now.
        for (let d = path.dirname(s.path); d !== path.dirname(d); d = path.dirname(d)) failedDirs.add(d);
      }
      helpers.tick(0, 1, name);
    }
    if (stoppedAt >= 0) {
      const rest = plan.slice(stoppedAt);
      for (const s of rest) rec.results.push({ source: s.path, status: 'cancelled' });
      const files = rest.filter((s) => s.kind === 'file').length;
      rec.notes = [`Stopped after ${destroyed} file${destroyed === 1 ? ' was' : 's were'} destroyed. ${files} file${files === 1 ? ' was' : 's were'} not touched${files ? `: ${rest.filter((s) => s.kind === 'file').slice(0, 5).map((s) => path.basename(s.path)).join(', ')}${files > 5 ? '…' : ''}` : ''}.`];
    } else {
      rec.notes = [`${destroyed} file${destroyed === 1 ? '' : 's'} overwritten ${passes === 1 ? 'once' : `${passes} times`} with random data and removed.`];
    }
    rec.undo = { kind: 'none', reason: 'Secure delete cannot be undone.' };
  };
}
