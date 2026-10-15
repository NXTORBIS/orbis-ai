import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable, type Writable } from 'node:stream';
import { makeError, OrbisError, toOrbisError, type OrbisErrorShape } from '../../shared/errors';
import type { ConflictDecision, ConflictInfo, ItemResult, OperationRecord, OperationRequest } from '../../shared/operations';
import { isRemoteRef, isWithinRemote, parseRemoteRef, remoteBase, remoteJoin, remoteParent, remoteRef, RemoteTransferParamsSchema } from '../../shared/remote';
import { childPath, isWithin, requireAbsolute, splitExt } from '../fs/paths';
import { measure, type ExternalRunner, type RunContext, type RunnerHelpers } from '../ops/OperationManager';
import type { RemoteService } from './RemoteService';
import type { RemoteFs } from './types';

/**
 * Operation runners for remote locations:
 *  - 'remote-transfer': copy or move between this computer and a server, or within one server
 *    (params.mode). Streams with progress, pause and cancel; every file is written to a
 *    temporary name in the destination folder, its size verified, then renamed into place
 *    (a new name never replaces anything; Replace is an explicit choice for files only).
 *    Moves remove the source only after the copy is complete and verified.
 *  - 'remote-delete': permanent deletion on a server (there is no Trash), item by item.
 *  - 'remote-save': "Upload changes" of a file opened from a server, only when the file on the
 *    server is unchanged since it was downloaded.
 */

const PART = '.orbis-part-';
type Kind = ConflictInfo['sourceKind'];
interface Info { kind: Kind; size?: number; modifiedMs?: number }

/** One side of a transfer: this computer or one remote connection. */
interface Side {
  readonly remote: boolean;
  /** How a path of this side appears in results and conflicts (a local path or a remote reference). */
  display(p: string): string;
  join(dir: string, name: string): string;
  base(p: string): string;
  parent(p: string): string;
  /** lstat-like; undefined when nothing is there. */
  stat(p: string): Promise<Info | undefined>;
  /** Child names, and how many the server reported with unsafe names (never used). */
  list(dir: string): Promise<{ names: string[]; refused: number }>;
  read(p: string, signal: AbortSignal): Promise<Readable>;
  mkdir(p: string): Promise<void>;
  write(p: string, size: number | undefined, signal: AbortSignal): Promise<{ stream: Writable; done: Promise<void> }>;
  /** Make a finished temporary file durable before it is committed. */
  sync(p: string): Promise<void>;
  setModified(p: string, ms: number): Promise<void>;
  /** Rename the temporary item into place; never replaces unless `replace` (files only). */
  commit(tmp: string, target: string, replace: boolean): Promise<void>;
  /** Move within this side without copying (same volume / same server); false when not possible. */
  move(from: string, to: string, replace: boolean): Promise<boolean>;
  /** Server-side copy into a new name, where the protocol offers one. */
  serverCopy?(from: string, to: string): Promise<void>;
  removeItem(p: string): Promise<void>;
  measure(p: string, signal: AbortSignal): Promise<{ bytes: number; items: number }>;
}

class LocalSide implements Side {
  readonly remote = false;
  display(p: string) { return p; }
  join(dir: string, name: string) { return childPath(dir, name, 'remote.transfer'); }
  base(p: string) { return path.basename(p); }
  parent(p: string) { return path.dirname(p); }
  async stat(p: string): Promise<Info | undefined> {
    const st = await fsp.lstat(p).catch((err) => {
      if ((err as { code?: string }).code === 'ENOENT') return undefined;
      throw new OrbisError(toOrbisError(err, 'remote.transfer', p, 'no'));
    });
    if (!st) return undefined;
    return { kind: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other', size: st.isFile() ? st.size : undefined, modifiedMs: st.mtimeMs };
  }
  async list(dir: string) { return { names: (await fsp.readdir(dir)).filter((n) => !n.startsWith(PART)), refused: 0 }; }
  async read(p: string) { return fs.createReadStream(p, { highWaterMark: 256 * 1024 }); }
  async mkdir(p: string) { await fsp.mkdir(p); }
  async write(p: string) {
    const stream = fs.createWriteStream(p, { flags: 'wx', mode: 0o644 });
    const done = new Promise<void>((resolve, reject) => {
      stream.on('close', resolve);
      stream.on('error', reject);
    });
    done.catch(() => undefined);
    return { stream, done };
  }
  async sync(p: string) {
    const fh = await fsp.open(p, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  }
  async setModified(p: string, ms: number) { await fsp.utimes(p, new Date(), new Date(ms)).catch(() => undefined); }
  async commit(tmp: string, target: string, replace: boolean) {
    if (replace) {
      await fsp.rename(tmp, target);
      return;
    }
    try {
      await fsp.link(tmp, target); // fails with EEXIST rather than overwriting
      await fsp.unlink(tmp);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST') throw makeError('already_exists', 'remote.transfer', { message: `“${path.basename(target)}” appeared at the destination during the transfer and was not overwritten.`, target, retryable: true });
      if (await this.stat(target)) throw makeError('already_exists', 'remote.transfer', { target });
      await fsp.rename(tmp, target);
    }
  }
  async move() { return false; }
  async removeItem(p: string) { await fsp.rm(p, { recursive: true, force: false }); }
  measure(p: string, signal: AbortSignal) { return measure(p, signal); }
}

class RemoteSide implements Side {
  readonly remote = true;
  constructor(readonly id: string, readonly fs: RemoteFs) {}
  display(p: string) { return remoteRef(this.id, p); }
  join(dir: string, name: string) {
    try {
      return remoteJoin(dir, name);
    } catch (err) {
      throw makeError('invalid_name', 'remote.transfer', { message: `“${name}” cannot be used as a name on the server: ${(err as Error).message}`, target: name });
    }
  }
  base(p: string) { return remoteBase(p); }
  parent(p: string) { return remoteParent(p) ?? '/'; }
  async stat(p: string): Promise<Info | undefined> {
    try {
      const e = await this.fs.stat(p);
      return { kind: e.kind, size: e.size, modifiedMs: e.modifiedMs };
    } catch (err) {
      if (err instanceof OrbisError && err.shape.category === 'not_found') return undefined;
      throw err;
    }
  }
  async list(dir: string) {
    const l = await this.fs.list(dir);
    return { names: l.entries.map((e) => e.name).filter((n) => !n.startsWith(PART)), refused: l.refused.length };
  }
  read(p: string, signal: AbortSignal) { return this.fs.read(p, { signal }); }
  mkdir(p: string) { return this.fs.mkdir(p); }
  write(p: string, size: number | undefined, signal: AbortSignal) { return this.fs.write(p, { size, signal }); }
  async sync() { /* the server has the data once the upload is acknowledged */ }
  async setModified(p: string, ms: number) { await this.fs.setModified?.(p, ms).catch(() => undefined); }
  commit(tmp: string, target: string, replace: boolean) { return this.fs.rename(tmp, target, { overwrite: replace }); }
  async move(from: string, to: string, replace: boolean) {
    await this.fs.rename(from, to, { overwrite: replace });
    return true;
  }
  get serverCopy() { return this.fs.copy ? (from: string, to: string) => this.fs.copy!(from, to) : undefined; }
  async removeItem(p: string) { await removeRemoteTree(this.fs, p); }
  async measure(p: string, signal: AbortSignal) {
    let bytes = 0;
    let items = 0;
    const walk = async (q: string, depth: number): Promise<void> => {
      if (signal.aborted) throw makeError('cancelled', 'remote.measure');
      const st = await this.fs.stat(q);
      items++;
      if (st.kind === 'file') bytes += st.size ?? 0;
      if (st.kind !== 'directory' || depth > 64) return;
      const l = await this.fs.list(q);
      for (const e of l.entries) {
        if (e.name.startsWith(PART)) continue;
        if (e.kind === 'directory') await walk(e.path, depth + 1);
        else {
          items++;
          if (e.kind === 'file') bytes += e.size ?? 0;
        }
      }
    };
    await walk(p, 0);
    return { bytes, items };
  }
}

/** Delete a remote item; folders are emptied item by item first (nothing is removed blindly). */
export async function removeRemoteTree(f: RemoteFs, p: string, opts: { signal?: AbortSignal; onItem?: () => void } = {}): Promise<void> {
  const st = await f.stat(p);
  if (st.kind !== 'directory') {
    await f.removeFile(p);
    opts.onItem?.();
    return;
  }
  const l = await f.list(p);
  if (l.refused.length) throw makeError('unsupported', 'remote.delete', { message: `The folder contains ${l.refused.length} item(s) with names Orbis Files does not accept, so it was not deleted.`, target: p });
  for (const e of l.entries) {
    if (opts.signal?.aborted) throw makeError('cancelled', 'remote.delete');
    if (e.kind === 'directory') await removeRemoteTree(f, e.path, opts);
    else {
      await f.removeFile(e.path);
      opts.onItem?.();
    }
  }
  await f.removeDir(p);
  opts.onItem?.();
}

async function uniqueOn(side: Side, dir: string, name: string): Promise<string> {
  const { stem, ext } = splitExt(name);
  const base = stem.replace(/ \((\d+)\)$/, '');
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await side.stat(side.join(dir, candidate)))) return candidate;
  }
  throw makeError('already_exists', 'remote.transfer', { message: 'Could not find a free name.' });
}

/** Which side and path a request string names. */
function endpoint(s: string, op: string): { ref?: { connectionId: string; path: string }; local?: string } {
  if (isRemoteRef(s)) {
    const r = parseRemoteRef(s);
    if (!r) throw makeError('invalid_path', op, { message: 'This is not a valid remote location.', target: s });
    return { ref: r };
  }
  return { local: requireAbsolute(s, op) };
}

export function makeRemoteRunners(remote: RemoteService, markRunning: (rec: OperationRecord) => void): {
  transfer: ExternalRunner; validateTransfer: (req: OperationRequest) => void;
  remove: ExternalRunner; validateRemove: (req: OperationRequest) => void;
  save: ExternalRunner; validateSave: (req: OperationRequest) => void;
} {
  const validateTransfer = (req: OperationRequest) => {
    const op = 'ops.remote-transfer';
    const params = RemoteTransferParamsSchema.safeParse(req.params ?? {});
    if (!params.success) throw makeError('validation', op, { message: 'Choose copy or move.' });
    if (!req.sources.length || !req.destination) throw makeError('validation', op, { message: 'Nothing to transfer, or no destination.' });
    const dest = endpoint(req.destination, op);
    const srcs = req.sources.map((s) => endpoint(s, op));
    const srcConn = new Set(srcs.map((s) => s.ref?.connectionId ?? 'local'));
    if (srcConn.size !== 1) throw makeError('validation', op, { message: 'All items must come from the same place.' });
    const from = [...srcConn][0]!;
    const to = dest.ref?.connectionId ?? 'local';
    if (from === 'local' && to === 'local') throw makeError('validation', op, { message: 'Use an ordinary copy or move between folders on this computer.' });
    if (from !== 'local' && to !== 'local' && from !== to) throw makeError('unsupported', op, { message: 'Copying directly between two different servers is not supported. Copy to this computer first.' });
    for (const id of new Set([from, to])) if (id !== 'local') remote.get(id); // the connection exists
  };

  const transfer: ExternalRunner = async (rec, req, ctx, helpers) => {
    const op = `ops.${rec.type}`;
    const mode = RemoteTransferParamsSchema.parse(req.params ?? {}).mode;
    const destEp = endpoint(rec.destination!, op);
    const srcEps = rec.sources.map((s) => endpoint(s, op));
    const srcId = srcEps[0]!.ref?.connectionId;
    const sideFor = async (id?: string): Promise<Side> => (id ? new RemoteSide(id, await remote.fs(id)) : new LocalSide());
    const src = await sideFor(srcId);
    const dst = srcId && destEp.ref?.connectionId === srcId ? src : await sideFor(destEp.ref?.connectionId);
    const sameSide = src === dst;
    const keepAlive = () => {
      if (srcId) remote.touch(srcId);
      if (destEp.ref) remote.touch(destEp.ref.connectionId);
    };
    const destDir = destEp.ref?.path ?? destEp.local!;
    const srcPath = (i: number) => srcEps[i]!.ref?.path ?? srcEps[i]!.local!;

    const destInfo = await dst.stat(destDir);
    if (destInfo?.kind !== 'directory') throw makeError(destInfo ? 'not_a_directory' : 'not_found', op, { message: 'The destination folder is not available.', target: rec.destination });

    // Measure (and refuse copying a folder into itself).
    let totalBytes = 0;
    let totalItems = 0;
    const rejected = new Set<number>();
    for (let i = 0; i < rec.sources.length; i++) {
      await ctx.gate();
      const sp = srcPath(i);
      const inside = sameSide && (dst.remote ? isWithinRemote(sp, destDir) : isWithin(sp, destDir));
      if (inside) {
        rejected.add(i);
        rec.results.push({ source: rec.sources[i]!, status: 'failed', error: { category: 'validation', operation: op, message: `Cannot ${mode} “${src.base(sp)}” into itself.`, dataChanged: 'no', retryable: false } });
        continue;
      }
      try {
        const m = await src.measure(sp, ctx.signal);
        totalBytes += m.bytes;
        totalItems += m.items;
      } catch (err) {
        const shape = toOrbisError(err, op, rec.sources[i], 'no');
        if (shape.category === 'cancelled') throw err;
        rejected.add(i);
        rec.results.push({ source: rec.sources[i]!, status: 'failed', error: shape });
      }
    }
    rec.progress = { totalItems, totalBytes, completedItems: 0, completedBytes: 0 };
    markRunning(rec);
    rec.undo = { kind: 'none', reason: 'Transfers to or from a server are not undone automatically.' };
    if (rejected.size === rec.sources.length) {
      rec.error = rec.results[0]?.error;
      return;
    }

    /** Temporary items on the destination that must go if the operation stops. */
    const temps = new Set<string>();
    const removeTemps = async () => {
      for (const t of temps) {
        if (dst.remote) await dst.removeItem(t).catch(() => undefined);
        else await fsp.rm(t, { recursive: true, force: true }).catch(() => undefined);
      }
      temps.clear();
    };

    const ask = async (s: string, t: string, si: Info, ti: Info, remaining: number): Promise<ConflictDecision['action']> => {
      const bothDirs = si.kind === 'directory' && ti.kind === 'directory';
      const anyDir = si.kind === 'directory' || ti.kind === 'directory';
      const allowed: NonNullable<ConflictInfo['allowed']> = bothDirs ? ['skip', 'keep-both', 'merge'] : anyDir ? ['skip', 'keep-both'] : ['skip', 'replace', 'keep-both'];
      const action = await helpers.ask({
        source: src.display(s), destination: dst.display(t), sourceKind: si.kind, destinationKind: ti.kind,
        sourceSize: si.size, destinationSize: ti.size, sourceModifiedMs: si.modifiedMs, destinationModifiedMs: ti.modifiedMs,
        suggestedName: await uniqueOn(dst, dst.parent(t), dst.base(t)), remaining, allowed,
      });
      // A choice made "for all" earlier may not fit this item: never replace a folder.
      return (allowed as string[]).includes(action) ? action : 'skip';
    };

    const copyFile = async (s: string, si: Info, t: string, replace: boolean) => {
      await ctx.gate();
      const tmp = dst.join(dst.parent(t), `${PART}${crypto.randomUUID()}`);
      temps.add(tmp);
      if (!dst.remote) helpers.temp(tmp);
      const name = src.base(s);
      let bytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _e, cb) {
          ctx.gate().then(() => {
            bytes += chunk.length;
            keepAlive();
            helpers.tick(chunk.length, 0, name);
            cb(null, chunk);
          }, cb);
        },
      });
      try {
        const input = await src.read(s, ctx.signal);
        const out = await dst.write(tmp, si.size, ctx.signal);
        await pipeline(input, counter, out.stream, { signal: ctx.signal });
        await out.done;
        // Cancelled while the last data was being confirmed: the file is not committed.
        if (ctx.signal.aborted) throw makeError('cancelled', op, { target: src.display(s) });
      } catch (err) {
        if (ctx.signal.aborted) throw makeError('cancelled', op, { target: src.display(s) });
        throw err;
      }
      const written = await dst.stat(tmp);
      if (si.size !== undefined && (written?.size !== si.size || bytes !== si.size)) {
        throw makeError('io', op, { message: 'The transferred size does not match the original (it may have changed during the transfer). Nothing was replaced.', target: src.display(s), retryable: true });
      }
      await dst.sync(tmp);
      if (si.modifiedMs) await dst.setModified(tmp, si.modifiedMs);
      await dst.commit(tmp, t, replace);
      temps.delete(tmp);
      if (!dst.remote) helpers.committed(tmp);
      helpers.tick(0, 1);
    };

    interface TreeState { failures: ItemResult[]; skipped: number }
    const copyTree = async (s: string, t: string, merge: boolean, replaceFile: boolean, st: TreeState): Promise<void> => {
      await ctx.gate();
      const si = await src.stat(s);
      if (!si) throw makeError('not_found', op, { target: src.display(s) });
      if (si.kind === 'symlink' || si.kind === 'other') {
        throw makeError('unsupported', op, { message: si.kind === 'symlink' ? 'Links are not copied to or from servers. Copy the item the link points to instead.' : 'Special files (devices, sockets, pipes) are not copied.', target: src.display(s) });
      }
      if (si.kind === 'file') return copyFile(s, si, t, replaceFile);
      if (!merge) await dst.mkdir(t);
      helpers.tick(0, 1, src.base(s));
      const { names, refused } = await src.list(s);
      if (refused) st.failures.push({ source: src.display(s), status: 'failed', error: { category: 'invalid_name', operation: op, message: `${refused} item(s) on the server have names Orbis Files does not accept (for example “../x” or “a/b”) and were not copied.`, dataChanged: 'partial', retryable: false } });
      for (const n of names) {
        const cs = src.join(s, n);
        let ct: string;
        try {
          ct = dst.join(t, n);
        } catch (err) {
          st.failures.push({ source: src.display(cs), status: 'failed', error: toOrbisError(err, op, src.display(cs), 'no') });
          continue;
        }
        try {
          const existing = merge ? await dst.stat(ct) : undefined;
          if (existing) {
            const ci = (await src.stat(cs))!;
            if (ci.kind === 'directory' && existing.kind === 'directory') {
              await copyTree(cs, ct, true, false, st);
              continue;
            }
            const action = await ask(cs, ct, ci, existing, 0);
            if (action === 'skip' || action === 'merge') {
              st.skipped++;
              const m = await src.measure(cs, ctx.signal).catch(() => ({ bytes: 0, items: 1 }));
              helpers.tick(m.bytes, m.items);
              continue;
            }
            if (action === 'keep-both') ct = dst.join(t, await uniqueOn(dst, t, n));
            await copyTree(cs, ct, false, action === 'replace', st);
            continue;
          }
          await copyTree(cs, ct, false, false, st);
        } catch (err) {
          const shape = toOrbisError(err, op, src.display(cs));
          if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
          st.failures.push({ source: src.display(cs), destination: dst.display(ct), status: 'failed', error: shape });
        }
      }
      if (si.modifiedMs) await dst.setModified(t, si.modifiedMs);
    };

    try {
      for (let i = 0; i < rec.sources.length; i++) {
        if (rejected.has(i)) continue;
        await ctx.gate();
        const source = rec.sources[i]!;
        const s = srcPath(i);
        let name = src.base(s);
        let t = '';
        try {
          t = dst.join(destDir, name);
          const si = await src.stat(s);
          if (!si) throw makeError('not_found', op, { message: 'The item no longer exists.', target: source });
          if (mode === 'move' && sameSide && s === t) {
            rec.results.push({ source, destination: dst.display(t), status: 'skipped' });
            continue;
          }
          let how: 'new' | 'replace' | 'merge' = 'new';
          const ti = await dst.stat(t);
          if (ti) {
            const action = await ask(s, t, si, ti, rec.sources.length - i);
            if (action === 'skip') {
              rec.results.push({ source, destination: dst.display(t), status: 'skipped' });
              const m = await src.measure(s, ctx.signal).catch(() => ({ bytes: 0, items: 1 }));
              helpers.tick(m.bytes, m.items);
              continue;
            }
            if (action === 'keep-both') {
              name = await uniqueOn(dst, destDir, name);
              t = dst.join(destDir, name);
            } else how = action === 'merge' ? 'merge' : 'replace';
          }
          // Within one server: rename instead of copying.
          if (mode === 'move' && sameSide && how !== 'merge' && (await dst.move(s, t, how === 'replace'))) {
            const m = await dst.measure(t, ctx.signal).catch(() => ({ bytes: 0, items: 1 }));
            helpers.tick(m.bytes, m.items, name);
            rec.results.push({ source, destination: dst.display(t), status: 'done' });
            continue;
          }
          // Within one WebDAV server: a server-side COPY into a temporary name, then renamed into place.
          if (mode === 'copy' && sameSide && how !== 'merge' && dst.serverCopy) {
            const tmp = dst.join(destDir, `${PART}${crypto.randomUUID()}`);
            temps.add(tmp);
            await dst.serverCopy(s, tmp);
            await dst.commit(tmp, t, how === 'replace' && si.kind === 'file');
            temps.delete(tmp);
            const m = await dst.measure(t, ctx.signal).catch(() => ({ bytes: 0, items: 1 }));
            helpers.tick(m.bytes, m.items, name);
            rec.results.push({ source, destination: dst.display(t), status: 'done' });
            continue;
          }
          const st: TreeState = { failures: [], skipped: 0 };
          await copyTree(s, t, how === 'merge', how === 'replace', st);
          if (st.failures.length) {
            const first = st.failures[0]!.error!;
            rec.results.push({ source, destination: dst.display(t), status: 'failed', error: { ...first, message: `${st.failures.length} item(s) inside could not be transferred. ${first.message}`, dataChanged: 'partial' } });
            continue; // a move whose copy is incomplete keeps its source
          }
          if (mode === 'move') {
            if (st.skipped) {
              rec.results.push({ source, destination: dst.display(t), status: 'failed', error: { category: 'already_exists', operation: op, message: `${st.skipped} conflicting item(s) were skipped, so the original folder was kept. Everything else was transferred.`, dataChanged: 'yes', retryable: false, target: source } });
              continue;
            }
            if (how !== 'merge') {
              const [a, b] = await Promise.all([src.measure(s, ctx.signal), dst.measure(t, ctx.signal)]);
              if (a.bytes !== b.bytes || a.items !== b.items) {
                rec.results.push({ source, destination: dst.display(t), status: 'failed', error: { category: 'io', operation: op, message: 'The transferred copy could not be verified, so the original was kept.', dataChanged: 'yes', retryable: true, target: source } });
                continue;
              }
            }
            await ctx.gate();
            await src.removeItem(s);
          }
          rec.results.push({ source, destination: dst.display(t), status: 'done' });
        } catch (err) {
          const shape: OrbisErrorShape = toOrbisError(err, op, source);
          if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
          rec.results.push({ source, destination: t ? dst.display(t) : undefined, status: 'failed', error: shape });
        }
      }
    } finally {
      await removeTemps();
    }
  };

  // ---------------------------------------------------------------- permanent delete on a server
  const validateRemove = (req: OperationRequest) => {
    const op = 'ops.remote-delete';
    if (!req.sources.length) throw makeError('validation', op, { message: 'Nothing to delete.' });
    const refs = req.sources.map((s) => parseRemoteRef(s));
    if (refs.some((r) => !r)) throw makeError('invalid_path', op, { message: 'Only items on a server can be deleted this way.' });
    if (new Set(refs.map((r) => r!.connectionId)).size !== 1) throw makeError('validation', op, { message: 'All items must be on the same server.' });
    remote.get(refs[0]!.connectionId);
    for (const r of refs) {
      if (r!.path === '/' || r!.path === remote.home(r!.connectionId)) throw makeError('permission_denied', op, { message: 'Orbis Files will not delete the top folder of a server or your home folder there.' });
    }
  };

  const removeRunner: ExternalRunner = async (rec, _req, ctx, helpers) => {
    const refs = rec.sources.map((s) => parseRemoteRef(s)!);
    const f = await remote.fs(refs[0]!.connectionId);
    rec.progress = { totalItems: refs.length, completedItems: 0, completedBytes: 0 };
    rec.undo = { kind: 'none', reason: 'Items deleted on a server are gone; there is no Trash there.' };
    markRunning(rec);
    for (let i = 0; i < refs.length; i++) {
      await ctx.gate();
      const source = rec.sources[i]!;
      try {
        await removeRemoteTree(f, refs[i]!.path, { signal: ctx.signal, onItem: () => remote.touch(refs[0]!.connectionId) });
        rec.results.push({ source, status: 'done' });
      } catch (err) {
        const shape = toOrbisError(err, 'ops.remote-delete', source, 'unknown');
        if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
        rec.results.push({ source, status: 'failed', error: shape });
      }
      helpers.tick(0, 1, remoteBase(refs[i]!.path));
    }
  };

  // ---------------------------------------------------------------- upload changes of an opened copy
  const validateSave = (req: OperationRequest) => {
    const op = 'ops.remote-save';
    const local = req.sources[0];
    if (req.sources.length !== 1 || !local || !req.destination) throw makeError('validation', op, { message: 'Choose one opened file.' });
    const copy = remote.openedCopy(local);
    if (!copy || copy.ref !== req.destination) throw makeError('validation', op, { message: 'Only a file opened from a server can be uploaded back to where it came from.' });
  };

  const save: ExternalRunner = async (rec, _req, ctx, helpers) => {
    const op = 'ops.remote-save';
    const local = rec.sources[0]!;
    const copy = remote.openedCopy(local);
    if (!copy) throw makeError('not_found', op, { message: 'This copy is no longer tracked.' });
    const r = parseRemoteRef(copy.ref)!;
    const f = await remote.fs(r.connectionId);
    const localSt = await fsp.lstat(local);
    if (!localSt.isFile()) throw makeError('not_found', op, { message: 'The edited copy is no longer a file.', target: local });
    rec.progress = { totalItems: 1, totalBytes: localSt.size, completedItems: 0, completedBytes: 0 };
    rec.undo = { kind: 'none', reason: 'An uploaded file replaces the version on the server.' };
    markRunning(rec);
    // Only when the server still has the version that was downloaded (size, time and entity tag).
    const now = await f.stat(r.path).catch((err) => {
      if (err instanceof OrbisError && err.shape.category === 'not_found') throw makeError('not_found', op, { message: `The file was deleted or renamed on the server since you opened it. Nothing was uploaded; your edited copy is kept at ${local}.`, target: copy.ref });
      throw err;
    });
    const changed = now.size !== copy.remote.size || (copy.remote.modifiedMs !== undefined && now.modifiedMs !== copy.remote.modifiedMs) || (copy.remote.etag !== undefined && now.etag !== copy.remote.etag);
    if (changed) {
      throw makeError('busy', op, { message: `The file on the server changed since you opened it, so your changes were not uploaded (that would overwrite someone else’s version). Your edited copy is kept at ${local}.`, target: copy.ref });
    }
    const side = new RemoteSide(r.connectionId, f);
    const dir = remoteParent(r.path) ?? '/';
    const tmp = remoteJoin(dir, `${PART}${crypto.randomUUID()}`);
    try {
      const out = await f.write(tmp, { size: localSt.size, signal: ctx.signal });
      const counter = new Transform({
        transform(chunk: Buffer, _e, cb) {
          ctx.gate().then(() => {
            remote.touch(r.connectionId);
            helpers.tick(chunk.length, 0, remoteBase(r.path));
            cb(null, chunk);
          }, cb);
        },
      });
      await pipeline(fs.createReadStream(local), counter, out.stream, { signal: ctx.signal });
      await out.done;
      const written = await f.stat(tmp);
      if (written.size !== localSt.size) throw makeError('io', op, { message: 'The uploaded size does not match the edited copy. The file on the server was not changed.', retryable: true });
      await side.commit(tmp, r.path, true);
    } catch (err) {
      await f.removeFile(tmp).catch(() => undefined);
      if (ctx.signal.aborted) throw makeError('cancelled', op);
      throw err;
    }
    const after = await f.stat(r.path);
    const localAfter = await fsp.stat(local);
    remote.markUploaded(local, after, { size: localAfter.size, mtimeMs: localAfter.mtimeMs });
    helpers.tick(0, 1);
    rec.results.push({ source: local, destination: copy.ref, status: 'done' });
  };

  return { transfer, validateTransfer, remove: removeRunner, validateRemove, save, validateSave };
}

export type { RunContext, RunnerHelpers };
