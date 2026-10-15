import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { ConflictChoiceSchema, conflictName, type ConflictChoice, type SyncEntryInfo, type SyncOptions, type SyncSide } from '../../shared/sync';
import type { OperationRecord } from '../../shared/operations';
import { isProtectedPath, measure, type ExternalRunner, type PlatformOps, type RunContext, type RunnerHelpers } from '../ops/OperationManager';
import { absIn, computePlan, HashCache, keyOf, parentKey, PART_PREFIX, type Baseline, type BaselineRow, type PlanAction, type PlanResult } from './engine';

/**
 * The 'sync' operation runner. It re-plans right before changing anything and
 * only carries out preview actions that are still exactly the same; anything
 * that changed since the preview is skipped and reported. Copies go to a
 * temporary sibling, are size-checked (and re-read and compared by SHA-256
 * when "verify" is on), keep the source's modification time and are then
 * committed without overwriting anything that appeared meanwhile. Deletions
 * and replaced versions go to the platform Trash, never permanently deleted.
 * Two-way runs then store the new baseline.
 */

export const SyncRunParams = z.object({
  planId: z.string().min(1).max(128),
  pairId: z.string().min(1).max(128).optional(),
  decisions: z.array(z.object({ id: z.number().int().nonnegative(), choice: ConflictChoiceSchema })).max(1_000_000).default([]),
});

export interface StoredPlan {
  planId: string;
  pairId?: string;
  createdMs: number;
  result: PlanResult;
}

export interface SyncRunnerDeps {
  getPlan(planId: string): StoredPlan | undefined;
  baseline(left: string, right: string): Baseline | undefined;
  saveBaseline(left: string, right: string, rows: BaselineRow[]): void;
  platform: PlatformOps;
  markRunning(rec: OperationRecord): void;
  /** Called once the run is set up; the service uses it to record the outcome on the saved pair. */
  track?(operationId: string, info: { pairId?: string; stats: RunStats }): void;
  now?: () => Date;
}

export interface RunStats {
  changedSincePreview: number;
  newSincePreview: number;
}

const CHANGED = 'changed-since-preview';

function changed(rel: string, what = 'changed after the preview'): OrbisError {
  return new OrbisError({
    category: 'validation', operation: 'sync.run', target: rel, cause: CHANGED, dataChanged: 'no', retryable: true,
    message: `“${rel}” ${what}, so it was not synchronized. Preview again to include it.`,
  });
}

const sig = (a: PlanAction) => `${a.action}|${a.to ?? ''}|${a.key}`;

function sameInfo(a?: SyncEntryInfo, b?: SyncEntryInfo): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && a.size === b.size && a.mtimeMs === b.mtimeMs && a.linkTarget === b.linkTarget;
}

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

type BaselineChange = { set: string; row: BaselineRow } | { remove: string };

export function makeSyncRunner(deps: SyncRunnerDeps): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const parsed = SyncRunParams.safeParse(req.params ?? {});
    if (!parsed.success) throw makeError('validation', 'sync.run', { message: 'The synchronization request is not valid.' });
    const stored = deps.getPlan(parsed.data.planId);
    if (!stored) throw makeError('validation', 'sync.run', { message: 'This preview is no longer available (previews are kept for an hour and are not kept across restarts). Preview again.' });
    rec.itemResults = true;
    const preview = stored.result;
    const { mode, options } = preview;
    const decisions = new Map(parsed.data.decisions.map((d) => [d.id, d.choice]));
    const stats: RunStats = { changedSincePreview: 0, newSincePreview: 0 };
    deps.track?.(rec.id, { pairId: parsed.data.pairId ?? stored.pairId, stats });
    rec.undo = { kind: 'none', reason: 'A synchronization is not reversed automatically. Items it deleted or replaced are in the Trash.' };

    // ---------------- re-plan right before executing
    const hashes = new HashCache();
    const checkpoint = () => ctx.gate();
    const fresh = await computePlan({
      left: preview.left, right: preview.right, mode, options, checkpoint, signal: ctx.signal, hashes,
      baseline: mode === 'two-way' ? deps.baseline(preview.left, preview.right) : undefined,
    });
    if (fresh.left !== preview.left || fresh.right !== preview.right) {
      throw makeError('validation', 'sync.run', { message: 'One of the folders now resolves to a different location. Preview again.' });
    }
    const roots: Record<SyncSide, string> = { left: fresh.left, right: fresh.right };
    const freshBySig = new Map(fresh.actions.map((a) => [sig(a), a]));
    const previewSigs = new Set(preview.actions.map(sig));
    const work: Array<{ a: PlanAction; choice?: ConflictChoice }> = [];
    const sourceOf = (a: PlanAction) => {
      const side: SyncSide = a.action === 'delete' ? a.to! : a.action === 'conflict' ? (a.left ? 'left' : 'right') : a.to === 'right' ? 'left' : 'right';
      return path.join(roots[side], ...(side === 'left' ? a.leftRel : a.rightRel).split('/'));
    };
    for (const a of preview.actions) {
      let choice: ConflictChoice | undefined;
      if (a.action === 'conflict') {
        choice = decisions.get(a.id) ?? 'skip';
        if (!a.choices?.includes(choice)) choice = 'skip';
        if (choice === 'skip') {
          rec.results.push({ source: sourceOf(a), status: 'skipped' });
          continue;
        }
      }
      const f = freshBySig.get(sig(a));
      if (!f || !sameInfo(a.left, f.left) || !sameInfo(a.right, f.right) || a.conflict !== f.conflict || a.items !== f.items || a.bytes !== f.bytes) {
        stats.changedSincePreview++;
        rec.results.push({ source: sourceOf(a), status: 'skipped', error: changed(a.rel).shape });
        continue;
      }
      work.push({ a: f, choice });
    }
    // Differences on paths the preview did not list at all (changed ones were counted above).
    const previewKeys = new Set(preview.actions.map((a) => a.key));
    stats.newSincePreview = fresh.actions.filter((a) => !previewSigs.has(sig(a)) && !previewKeys.has(a.key)).length;

    // Order: deletions, then new folders (outermost first), then files and links, then conflicts.
    const phase = (w: { a: PlanAction }) => (w.a.action === 'delete' ? 0 : w.a.action === 'conflict' ? 3 : w.a.kind === 'directory' ? 1 : 2);
    work.sort((x, y) => phase(x) - phase(y) || (phase(x) === 1 ? x.a.key.split('/').length - y.a.key.split('/').length : 0));
    rec.progress = {
      totalItems: work.length,
      totalBytes: work.reduce((n, w) => n + (w.a.action === 'delete' || w.choice === 'skip' ? 0 : w.a.bytes), 0),
      completedItems: 0,
      completedBytes: 0,
    };
    deps.markRunning(rec);

    // Both folders must still be the folders that were planned (not replaced by links).
    for (const side of ['left', 'right'] as const) {
      const real = await fsp.realpath(roots[side]).catch(() => undefined);
      if (real !== roots[side]) throw makeError('validation', 'sync.run', { message: `The ${side} folder changed or disappeared. Preview again.`, target: roots[side] });
    }

    const exec = new Executor(roots, options, ctx, helpers, deps, hashes, fresh.caseInsensitive, mode === 'two-way');
    const changes: BaselineChange[] = [];
    let i = 0;
    try {
      for (; i < work.length; i++) {
        await ctx.gate();
        const { a, choice } = work[i]!;
        try {
          const r = await exec.run(a, choice);
          changes.push(...r.changes);
          rec.results.push({ source: r.source, destination: r.destination, status: 'done' });
        } catch (err) {
          const shape = toOrbisError(err, 'sync.run', a.rel, 'no');
          if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
          if (shape.cause === CHANGED) stats.changedSincePreview++;
          rec.results.push({ source: sourceOf(a), status: shape.cause === CHANGED ? 'skipped' : 'failed', error: shape });
        }
        helpers.tick(0, 1, a.rel);
      }
    } catch (err) {
      // Stopped: the item in progress left nothing behind (its temporary file is removed); the rest never started.
      for (let j = i; j < work.length; j++) rec.results.push({ source: sourceOf(work[j]!.a), status: 'cancelled' });
      throw err;
    } finally {
      const notes: string[] = [];
      if (stats.changedSincePreview) notes.push(`${stats.changedSincePreview} item(s) changed after the preview and were skipped. Preview again to include them.`);
      if (stats.newSincePreview) notes.push(`${stats.newSincePreview} difference(s) appeared after the preview and were not synchronized. Preview again to include them.`);
      const undecided = preview.actions.filter((a) => a.action === 'conflict' && (decisions.get(a.id) ?? 'skip') === 'skip').length;
      if (undecided) notes.push(`${undecided} conflict(s) were skipped (left as they are on both sides).`);
      if (mode === 'two-way') {
        try {
          deps.saveBaseline(fresh.left, fresh.right, nextBaseline(fresh, changes, hashes));
          notes.push('The state of both folders was recorded for the next two-way synchronization.');
        } catch (err) {
          notes.push(`The synchronization state could not be saved (${(err as Error).message}); the next run compares against the previous state.`);
        }
      }
      rec.notes = [...(rec.notes ?? []), ...notes];
    }
  };
}

/** New baseline: the previous one, updated with everything now known to be the same on both sides. */
function nextBaseline(fresh: PlanResult, changes: BaselineChange[], hashes: HashCache): BaselineRow[] {
  const rows = new Map(fresh.baselineKeys);
  const unreadable = new Set([...fresh.leftScan.unreadable, ...fresh.rightScan.unreadable]);
  const hidden = (k: string) => {
    for (let p = k; ; p = parentKey(p)) {
      if (unreadable.has(p)) return true;
      if (p === '') return false;
    }
  };
  // Gone from both sides (or now outside the patterns): forgotten, unless it could not be read.
  for (const k of [...rows.keys()]) if (!fresh.leftScan.entries.has(k) && !fresh.rightScan.entries.has(k) && !hidden(k)) rows.delete(k);
  for (const s of fresh.inSync) {
    const la = path.join(fresh.left, ...s.l.rel.split('/'));
    const ra = path.join(fresh.right, ...s.r.rel.split('/'));
    const lh = s.l.kind === 'file' ? hashes.peek(la, s.l.size, s.l.mtimeMs) : undefined;
    const rh = s.r.kind === 'file' ? hashes.peek(ra, s.r.size, s.r.mtimeMs) : undefined;
    rows.set(s.key, {
      rel: s.l.rel, kind: s.l.kind, size: s.l.kind === 'file' ? s.l.size : undefined, leftMtimeMs: s.l.mtimeMs, rightMtimeMs: s.r.mtimeMs,
      sha256: lh && lh === rh ? lh : undefined, linkTarget: s.l.linkTarget,
    });
  }
  for (const c of changes) {
    if ('set' in c) rows.set(c.set, c.row);
    else {
      rows.delete(c.remove);
      for (const k of [...rows.keys()]) if (k.startsWith(`${c.remove}/`)) rows.delete(k);
    }
  }
  return [...rows.values()];
}

type Kind = 'file' | 'directory' | 'symlink' | 'other';
const kindOf = (st: fs.Stats): Kind => (st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other');

class Executor {
  constructor(
    private readonly roots: Record<SyncSide, string>,
    private readonly options: SyncOptions,
    private readonly ctx: RunContext,
    private readonly helpers: RunnerHelpers,
    private readonly deps: SyncRunnerDeps,
    private readonly hashes: HashCache,
    private readonly caseInsensitive: boolean,
    private readonly twoWay: boolean,
  ) {}

  private abs(side: SyncSide, rel: string): string {
    return absIn(this.roots[side], rel, 'sync.run');
  }

  /**
   * Every folder on the way to an item must be a real folder inside the root
   * (never a link), so nothing can be written or removed outside it.
   */
  private async folderChain(side: SyncSide, relDir: string, create: boolean): Promise<void> {
    if (!relDir) return;
    let cur = this.roots[side];
    for (const seg of relDir.split('/')) {
      cur = path.join(cur, seg);
      let st = await fsp.lstat(cur).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return undefined;
        throw err;
      });
      if (!st) {
        if (!create) throw changed(relDir, 'is no longer there');
        await fsp.mkdir(cur).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'EEXIST') throw err;
        });
        st = await fsp.lstat(cur);
      }
      if (st.isSymbolicLink() || !st.isDirectory()) {
        throw makeError('invalid_path', 'sync.run', { message: `“${relDir}” is not a plain folder (it is a link or a file), so nothing is written or removed inside it.`, target: cur });
      }
    }
  }

  /** The item must look exactly as planned (or be absent when `want` is undefined). */
  private async expect(abs: string, rel: string, want: SyncEntryInfo | undefined): Promise<fs.Stats | undefined> {
    const st = await fsp.lstat(abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    });
    if (!want) {
      if (st) throw changed(rel, 'appeared after the preview');
      return undefined;
    }
    if (!st) throw changed(rel, 'is no longer there');
    if (kindOf(st) !== want.kind) throw changed(rel);
    if (want.kind === 'file' && (st.size !== want.size || st.mtimeMs !== want.mtimeMs)) throw changed(rel);
    if (want.kind === 'symlink' && (await fsp.readlink(abs)) !== want.linkTarget) throw changed(rel);
    return st;
  }

  private async toTrash(abs: string): Promise<void> {
    if (!this.deps.platform.trashSupported) throw makeError('unsupported', 'sync.run', { message: 'The Trash is not available here, so nothing is deleted or replaced.', target: abs });
    if (isProtectedPath(abs)) throw makeError('permission_denied', 'sync.run', { target: abs });
    await this.deps.platform.trash(abs);
  }

  /** Put a finished temporary file in place without overwriting anything. */
  private async commitNew(tmp: string, dst: string, rel: string): Promise<void> {
    try {
      await fsp.link(tmp, dst);
      await fsp.unlink(tmp);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw changed(rel, 'appeared after the preview');
      // No hard links here (FAT, some network shares): check, then rename.
      if (await fsp.lstat(dst).then(() => true, () => false)) throw changed(rel, 'appeared after the preview');
      await fsp.rename(tmp, dst);
    }
  }

  /** Rename within a folder without replacing anything. */
  private async renameNoReplace(from: string, to: string, rel: string): Promise<void> {
    try {
      await fsp.link(from, to);
      await fsp.unlink(from);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw changed(rel, 'appeared after the preview');
      if (await fsp.lstat(to).then(() => true, () => false)) throw changed(rel, 'appeared after the preview');
      await fsp.rename(from, to);
    }
  }

  private async sha(p: string): Promise<string> {
    const h = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(p, { highWaterMark: 1024 * 1024 }), new Transform({
      transform: (chunk: Buffer, _e, cb) => {
        this.ctx.gate().then(() => {
          h.update(chunk);
          cb();
        }, cb);
      },
    }), { signal: this.ctx.signal }).catch((err) => {
      if (this.ctx.signal.aborted) throw makeError('cancelled', 'sync.run');
      throw err;
    });
    return h.digest('hex');
  }

  private async copyFile(src: string, dst: string, rel: string, srcSt: fs.Stats, replace: SyncEntryInfo | undefined): Promise<string | undefined> {
    const tmp = path.join(path.dirname(dst), `${PART_PREFIX}${crypto.randomUUID()}`);
    this.helpers.temp(tmp);
    const hash = this.options.verify ? crypto.createHash('sha256') : undefined;
    const ctx = this.ctx;
    const tick = this.helpers.tick;
    const name = path.basename(src);
    const gate = new Transform({
      transform(chunk: Buffer, _e, cb) {
        ctx.gate().then(() => {
          hash?.update(chunk);
          tick(chunk.length, 0, name);
          cb(null, chunk);
        }, cb);
      },
    });
    try {
      await pipeline(fs.createReadStream(src, { highWaterMark: 1024 * 1024 }), gate, fs.createWriteStream(tmp, { flags: 'wx', mode: srcSt.mode & 0o777 }), { signal: ctx.signal });
    } catch (err) {
      if (ctx.signal.aborted) throw makeError('cancelled', 'sync.run', { target: src });
      throw err;
    }
    const fh = await fsp.open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const after = await fsp.lstat(src);
    if ((await fsp.stat(tmp)).size !== srcSt.size || after.size !== srcSt.size || after.mtimeMs !== srcSt.mtimeMs) throw changed(rel, 'changed while it was being copied');
    let digest: string | undefined;
    if (hash) {
      digest = hash.digest('hex');
      if ((await this.sha(tmp)) !== digest) {
        throw makeError('io', 'sync.run', { message: `The copy of “${rel}” did not match the original when it was read back, so it was not used.`, target: dst, retryable: true });
      }
    }
    await fsp.utimes(tmp, srcSt.atimeMs / 1000, srcSt.mtimeMs / 1000);
    if (!replace) await this.commitNew(tmp, dst, rel);
    else {
      await this.expect(dst, rel, replace);
      if (this.options.trashReplaced) {
        await this.toTrash(dst);
        await this.commitNew(tmp, dst, rel);
      } else {
        await fsp.rename(tmp, dst); // atomic replace
      }
    }
    this.helpers.committed(tmp);
    if (digest) this.hashes.put(src, srcSt.size, srcSt.mtimeMs, digest);
    return digest;
  }

  /** Copy one item from one side to the other; returns its new baseline row. */
  private async transfer(
    from: SyncSide, to: SyncSide,
    o: { srcRel: string; dstRel: string; want: SyncEntryInfo; replace?: SyncEntryInfo },
  ): Promise<{ row: BaselineRow; source: string; destination: string }> {
    const src = this.abs(from, o.srcRel);
    const dst = this.abs(to, o.dstRel);
    await this.folderChain(from, dirOf(o.srcRel), false);
    await this.folderChain(to, dirOf(o.dstRel), true);
    const srcSt = (await this.expect(src, o.srcRel, o.want))!;
    await this.expect(dst, o.dstRel, o.replace);
    let digest: string | undefined;
    if (o.want.kind === 'directory') {
      await fsp.mkdir(dst).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'EEXIST') throw changed(o.dstRel, 'appeared after the preview');
        throw err;
      });
    } else if (o.want.kind === 'symlink') {
      const target = await fsp.readlink(src);
      if (target !== o.want.linkTarget) throw changed(o.srcRel);
      if (!o.replace) {
        await fsp.symlink(target, dst).catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'EEXIST') throw changed(o.dstRel, 'appeared after the preview');
          throw err;
        });
      } else if (this.options.trashReplaced) {
        await this.toTrash(dst);
        await fsp.symlink(target, dst);
      } else {
        const tmp = path.join(path.dirname(dst), `${PART_PREFIX}${crypto.randomUUID()}`);
        this.helpers.temp(tmp);
        await fsp.symlink(target, tmp);
        await fsp.rename(tmp, dst);
        this.helpers.committed(tmp);
      }
    } else {
      digest = await this.copyFile(src, dst, o.srcRel, srcSt, o.replace);
    }
    const dstSt = await fsp.lstat(dst);
    if (o.want.kind === 'file' && dstSt.size !== srcSt.size) throw makeError('io', 'sync.run', { message: `The copy of “${o.srcRel}” has the wrong size.`, target: dst });
    const ls = from === 'left' ? srcSt : dstSt;
    const rs = from === 'left' ? dstSt : srcSt;
    return {
      source: src,
      destination: dst,
      row: {
        rel: from === 'left' ? o.srcRel : o.dstRel, kind: o.want.kind, size: o.want.kind === 'file' ? srcSt.size : undefined,
        leftMtimeMs: ls.mtimeMs, rightMtimeMs: rs.mtimeMs, sha256: digest, linkTarget: o.want.linkTarget,
      },
    };
  }

  private async remove(a: PlanAction, side: SyncSide, want: SyncEntryInfo): Promise<{ source: string }> {
    const rel = side === 'left' ? a.leftRel : a.rightRel;
    const p = this.abs(side, rel);
    await this.folderChain(side, dirOf(rel), false);
    await this.expect(p, rel, want);
    if (want.kind === 'directory' && a.action === 'delete') {
      // A folder is removed as a whole only if it still holds exactly what was planned.
      const m = await measure(p, this.ctx.signal);
      if (m.items !== (a.items ?? 0) + 1 || m.bytes !== a.bytes) throw changed(rel, 'has different contents than at the preview');
    }
    await this.toTrash(p);
    return { source: p };
  }

  async run(a: PlanAction, choice?: ConflictChoice): Promise<{ source: string; destination?: string; changes: BaselineChange[] }> {
    if (a.action === 'delete') {
      const side = a.to!;
      const r = await this.remove(a, side, (side === 'left' ? a.left : a.right)!);
      return { source: r.source, changes: [{ remove: a.key }] };
    }
    if (a.action === 'copy' || a.action === 'update') {
      const to = a.to!;
      const from: SyncSide = to === 'right' ? 'left' : 'right';
      const t = await this.transfer(from, to, {
        srcRel: from === 'left' ? a.leftRel : a.rightRel,
        dstRel: to === 'left' ? a.leftRel : a.rightRel,
        want: (from === 'left' ? a.left : a.right)!,
        replace: a.action === 'update' ? (to === 'left' ? a.left : a.right) : undefined,
      });
      return { source: t.source, destination: t.destination, changes: [{ set: a.key, row: t.row }] };
    }
    // conflicts
    if (choice === 'left' || choice === 'right') {
      const from: SyncSide = choice;
      const to: SyncSide = choice === 'left' ? 'right' : 'left';
      const want = from === 'left' ? a.left : a.right;
      const there = to === 'left' ? a.left : a.right;
      if (!want) {
        // The chosen side deleted it: remove the other side's version (to the Trash).
        const r = await this.remove(a, to, there!);
        return { source: r.source, changes: [{ remove: a.key }] };
      }
      const t = await this.transfer(from, to, { srcRel: from === 'left' ? a.leftRel : a.rightRel, dstRel: to === 'left' ? a.leftRel : a.rightRel, want, replace: there });
      return { source: t.source, destination: t.destination, changes: [{ set: a.key, row: t.row }] };
    }
    if (choice === 'both' && a.left?.kind === 'file' && a.right?.kind === 'file') {
      // The right-hand (target) version keeps its contents under a "(conflict date)" name; the left version takes the name.
      const lAbs = this.abs('left', a.leftRel);
      const rAbs = this.abs('right', a.rightRel);
      await this.folderChain('left', dirOf(a.leftRel), false);
      await this.folderChain('right', dirOf(a.rightRel), false);
      await this.expect(lAbs, a.leftRel, a.left);
      await this.expect(rAbs, a.rightRel, a.right);
      const date = (this.deps.now ?? (() => new Date()))();
      let name = '';
      for (let n = 1; n < 1000; n++) {
        const candidate = conflictName(nameOf(a.rightRel), date, n);
        const taken = await Promise.all([
          fsp.lstat(path.join(path.dirname(rAbs), candidate)).then(() => true, () => false),
          this.twoWay ? fsp.lstat(path.join(path.dirname(lAbs), candidate)).then(() => true, () => false) : Promise.resolve(false),
        ]);
        if (!taken[0] && !taken[1]) {
          name = candidate;
          break;
        }
      }
      if (!name) throw makeError('already_exists', 'sync.run', { message: 'No free name for the conflicting copy.', target: rAbs });
      const keptRel = joinRel(dirOf(a.rightRel), name);
      await this.renameNoReplace(rAbs, this.abs('right', keptRel), keptRel);
      const changes: BaselineChange[] = [];
      if (this.twoWay) {
        const leftCopyRel = joinRel(dirOf(a.leftRel), name);
        const t = await this.transfer('right', 'left', { srcRel: keptRel, dstRel: leftCopyRel, want: a.right });
        changes.push({ set: keyOf(leftCopyRel, this.caseInsensitive), row: t.row });
      }
      const t = await this.transfer('left', 'right', { srcRel: a.leftRel, dstRel: a.rightRel, want: a.left });
      changes.push({ set: a.key, row: t.row });
      return { source: t.source, destination: t.destination, changes };
    }
    throw makeError('validation', 'sync.run', { message: `This choice is not available for “${a.rel}”.`, target: a.rel });
  }
}
