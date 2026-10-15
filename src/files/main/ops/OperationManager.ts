import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { makeError, OrbisError, toOrbisError, type OrbisErrorShape } from '../../shared/errors';
import {
  canTransition,
  TERMINAL_STATES,
  type ConflictDecision,
  type ConflictInfo,
  type ConflictPolicy,
  type ItemResult,
  type OperationRecord,
  type OperationRequest,
  type OperationState,
} from '../../shared/operations';
import { isWithin, requireAbsolute, splitExt, uniqueName, validateName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import { isRemoteRef, parseRemoteRef, remoteRef } from '../../shared/remote';

/**
 * Shared operation engine. Toolbar, context menu, shortcuts, drag-and-drop,
 * command palette and AI-approved plans all submit OperationRequests here.
 */

export interface PlatformOps {
  /** Move to Trash/Recycle Bin. Rejects if unsupported. */
  trash(p: string): Promise<void>;
  trashSupported: boolean;
  /**
   * Find where the Trash put an item trashed at or after `sinceMs` (Linux: by its
   * .trashinfo). When available, trash operations can be undone by restoring.
   */
  locateTrashed?(original: string, sinceMs: number): Promise<{ trashDir: string; name: string } | undefined>;
  /** What to tell the user about undoing a move to the Trash when it cannot be done here. */
  trashRestoreHint?: string;
}

export interface OperationStore {
  save(rec: OperationRecord): void;
  loadAll(): OperationRecord[];
  remove(id: string): void;
}

export interface CatalogHooks {
  onMoved(from: string, to: string): void;
  onRemoved(p: string): void;
}

export interface RunnerHelpers {
  /** Ask the user (or apply the policy) about a destination conflict. */
  ask(info: Omit<ConflictInfo, 'operationId'>): Promise<ConflictDecision['action']>;
  /** Report progress; throttled internally. */
  tick(bytes: number, items: number, current?: string): void;
  /** Register a temporary file that must be removed if the operation stops. */
  temp(p: string): void;
  committed(p: string): void;
}

/** Plugins for operation types implemented in other modules (archives). */
export type ExternalRunner = (rec: OperationRecord, req: OperationRequest, ctx: RunContext, helpers: RunnerHelpers) => Promise<void>;

const PART_PREFIX = '.orbis-part-';

export class RunContext {
  paused = false;
  private resumeWaiters: Array<() => void> = [];
  readonly abort = new AbortController();
  applyToAll: ConflictDecision['action'] | undefined;
  decisionResolver: ((d: ConflictDecision) => void) | undefined;
  tempFiles = new Set<string>();
  /** Told when the operation is paused or resumed (runners that drive an external process stop and continue it). */
  private pauseListeners = new Set<(paused: boolean) => void>();

  constructor(readonly policy: ConflictPolicy) {}

  /** Call `fn(true)` when the operation is paused and `fn(false)` when it resumes or is cancelled. Returns an unsubscribe function. */
  onPauseChange(fn: (paused: boolean) => void): () => void {
    this.pauseListeners.add(fn);
    return () => this.pauseListeners.delete(fn);
  }

  pause(): void {
    this.paused = true;
    for (const fn of [...this.pauseListeners]) fn(true);
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Waits while paused; throws if cancelled. */
  async gate(): Promise<void> {
    if (this.signal.aborted) throw makeError('cancelled', 'ops.run');
    while (this.paused) {
      await new Promise<void>((r) => this.resumeWaiters.push(r));
      if (this.signal.aborted) throw makeError('cancelled', 'ops.run');
    }
  }

  resume(): void {
    const was = this.paused;
    this.paused = false;
    if (was) for (const fn of [...this.pauseListeners]) fn(false);
    const w = this.resumeWaiters;
    this.resumeWaiters = [];
    w.forEach((r) => r());
  }

  cancel(): void {
    this.abort.abort();
    this.resume();
    this.decisionResolver?.({ action: 'cancel', applyToAll: true });
  }
}

/** Paths that cannot be permanently deleted or trashed as a whole. */
export function isProtectedPath(p: string): boolean {
  const r = path.resolve(p);
  if (path.parse(r).root === r) return true;
  if (r === path.resolve(os.homedir())) return true;
  return false;
}

export class OperationManager extends EventEmitter {
  /** Allow external runners to move from preparing to running once measured. */
  markRunning(rec: OperationRecord): void {
    this.setState(rec, 'running');
  }

  private records = new Map<string, OperationRecord>();
  private contexts = new Map<string, RunContext>();
  private requests = new Map<string, OperationRequest>();
  private queue: string[] = [];
  private running = new Set<string>();
  private external = new Map<string, ExternalRunner>();
  /** Checks run synchronously when an operation of a runner's type is requested (bad requests are refused before queueing). */
  private validators = new Map<string, (req: OperationRequest) => void>();
  maxConcurrent = 2;

  constructor(
    private readonly platform: PlatformOps,
    private readonly store?: OperationStore,
    private readonly hooks?: CatalogHooks,
  ) {
    super();
  }

  registerRunner(type: string, runner: ExternalRunner, validate?: (req: OperationRequest) => void): void {
    this.external.set(type, runner);
    if (validate) this.validators.set(type, validate);
  }

  /** On startup: mark unfinished operations interrupted and locate partial files. */
  async recoverInterrupted(): Promise<OperationRecord[]> {
    if (!this.store) return [];
    const recovered: OperationRecord[] = [];
    for (const rec of this.store.loadAll()) {
      if (TERMINAL_STATES.has(rec.state)) {
        this.records.set(rec.id, rec);
        continue;
      }
      const partials: string[] = [];
      if (rec.destination && !isRemoteRef(rec.destination)) {
        try {
          for (const n of await fsp.readdir(rec.destination)) if (n.startsWith(PART_PREFIX)) partials.push(path.join(rec.destination, n));
        } catch {
          /* destination missing */
        }
      }
      rec.state = 'interrupted';
      rec.finishedMs = Date.now();
      rec.error = {
        category: 'internal',
        operation: `ops.${rec.type}`,
        message:
          'Orbis Files closed before this operation finished. Items listed as done were completed; the rest were not.' +
          (partials.length ? ` ${partials.length} incomplete temporary file(s) remain in the destination.` : ''),
        dataChanged: rec.progress.completedItems > 0 ? 'partial' : 'unknown',
        retryable: true,
        cause: partials.length ? `partial files: ${partials.map((p) => path.basename(p)).join(', ')}` : undefined,
      };
      (rec as OperationRecord & { partials?: string[] }).partials = partials;
      this.records.set(rec.id, rec);
      this.store.save(rec);
      recovered.push(rec);
    }
    return recovered;
  }

  list(): OperationRecord[] {
    return [...this.records.values()].sort((a, b) => b.createdMs - a.createdMs);
  }

  get(id: string): OperationRecord | undefined {
    return this.records.get(id);
  }

  start(req: OperationRequest): OperationRecord {
    const id = crypto.randomUUID();
    // Remote items (orbis-remote://…) are only accepted by the remote runners, which resolve them
    // through their connection; everything else must be an absolute local path.
    const remoteType = req.type.startsWith('remote-');
    const norm = (p: string) => {
      if (!isRemoteRef(p)) return requireAbsolute(p, `ops.${req.type}`);
      const r = remoteType ? parseRemoteRef(p) : null;
      if (!r) throw makeError('invalid_path', `ops.${req.type}`, { message: remoteType ? 'This is not a valid remote location.' : 'Items on a server cannot be used here.', target: p });
      return remoteRef(r.connectionId, r.path);
    };
    const sources = req.sources.map(norm);
    const destination = req.destination ? norm(req.destination) : undefined;
    if ((req.type === 'copy' || req.type === 'move' || req.type === 'extract' || req.type === 'compress' || req.type === 'convert') && !destination) {
      throw makeError('validation', `ops.${req.type}`, { message: 'A destination is required.' });
    }
    if ((req.type === 'trash' || req.type === 'delete') && sources.some(isProtectedPath)) {
      throw makeError('permission_denied', `ops.${req.type}`, { message: 'Orbis Files will not delete a drive root or your home folder.' });
    }
    if (req.type === 'trash' && !this.platform.trashSupported) {
      throw makeError('unsupported', 'ops.trash', { message: 'Trash is not available on this system. Use permanent delete instead.' });
    }
    if (!['copy', 'move', 'trash', 'delete', 'duplicate', 'rename-batch'].includes(req.type) && !this.external.has(req.type)) {
      throw makeError('unsupported', `ops.${req.type}`);
    }
    if ((req.type === 'dedupe' || req.type === 'shred' || req.type === 'flatten') && sources.some(isProtectedPath)) {
      throw makeError('permission_denied', `ops.${req.type}`, { message: 'Orbis Files will not act on a drive root or your home folder.' });
    }
    this.validators.get(req.type)?.({ ...req, sources, destination });
    const rec: OperationRecord = {
      id,
      type: req.type,
      state: 'queued',
      sources,
      destination,
      origin: req.origin ?? 'ui',
      createdMs: Date.now(),
      progress: { completedItems: 0, completedBytes: 0 },
      results: [],
      pausable: req.type !== 'rename-batch',
    };
    this.records.set(id, rec);
    this.requests.set(id, { ...req, sources, destination });
    this.contexts.set(id, new RunContext(req.conflictPolicy ?? 'ask'));
    this.queue.push(id);
    this.persist(rec);
    this.emitUpdate(rec);
    this.pump();
    return structuredClone(rec);
  }

  private persist(rec: OperationRecord): void {
    try {
      this.store?.save(rec);
    } catch {
      /* persistence failure must not break the running operation */
    }
  }

  private emitUpdate(rec: OperationRecord): void {
    this.emit('update', structuredClone(rec));
  }

  private setState(rec: OperationRecord, to: OperationState): boolean {
    if (rec.state === to) return true;
    if (!canTransition(rec.state, to)) return false;
    rec.state = to;
    if (to === 'running' && !rec.startedMs) rec.startedMs = Date.now();
    if (TERMINAL_STATES.has(to)) rec.finishedMs = Date.now();
    this.persist(rec);
    this.emitUpdate(rec);
    return true;
  }

  /** Two operations conflict when any of their roots overlap. */
  private overlaps(a: OperationRecord, b: OperationRecord): boolean {
    const roots = (r: OperationRecord) => [...r.sources, ...(r.destination ? [r.destination] : [])];
    // A remote reference and a local path never overlap; two references compare like paths.
    const within = (p: string, c: string) => isRemoteRef(p) === isRemoteRef(c) && (isRemoteRef(p) ? c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`) : isWithin(p, c));
    for (const x of roots(a)) for (const y of roots(b)) if (within(x, y) || within(y, x)) {
      // Two copies reading from the same source into different destinations are safe.
      if ((a.type === 'copy' || a.type === 'duplicate') && (b.type === 'copy' || b.type === 'duplicate') && a.sources.includes(x) && b.sources.includes(y)) continue;
      return true;
    }
    return false;
  }

  private pump(): void {
    for (const id of [...this.queue]) {
      if (this.running.size >= this.maxConcurrent) return;
      const rec = this.records.get(id)!;
      if (rec.state !== 'queued') {
        this.queue = this.queue.filter((q) => q !== id);
        continue;
      }
      const blocked = [...this.running].some((rid) => this.overlaps(rec, this.records.get(rid)!));
      if (blocked) continue;
      this.queue = this.queue.filter((q) => q !== id);
      this.running.add(id);
      void this.execute(id).finally(() => {
        this.running.delete(id);
        this.pump();
      });
    }
  }

  private async execute(id: string): Promise<void> {
    const rec = this.records.get(id)!;
    const req = this.requests.get(id)!;
    const ctx = this.contexts.get(id)!;
    this.setState(rec, 'preparing');
    let failure: unknown;
    try {
      switch (rec.type) {
        case 'copy':
        case 'duplicate':
        case 'move':
          await this.runTransfer(rec, ctx);
          break;
        case 'trash':
        case 'delete':
          await this.runRemove(rec, ctx);
          break;
        case 'rename-batch':
          await this.runRenameBatch(rec, req, ctx);
          break;
        default: {
          const runner = this.external.get(rec.type)!;
          let lastEmit = 0;
          await runner(rec, req, ctx, {
            ask: (info) => this.askConflict(rec, ctx, info),
            tick: (bytes, items, current) => {
              rec.progress.completedBytes += bytes;
              rec.progress.completedItems += items;
              if (current) rec.progress.currentItem = current;
              const t = Date.now();
              if (t - lastEmit > 120) {
                lastEmit = t;
                this.emitUpdate(rec);
              }
            },
            temp: (p) => ctx.tempFiles.add(p),
            committed: (p) => ctx.tempFiles.delete(p),
          });
          if (rec.state === 'preparing') this.setState(rec, 'running');
        }
      }
    } catch (err) {
      failure = err;
    }
    // Remove partial temporary files BEFORE announcing a terminal state.
    await this.cleanupTemps(ctx);
    try {
      if (failure === undefined) {
        this.finish(rec, ctx);
        return;
      }
      const shape = toOrbisError(failure, `ops.${rec.type}`, undefined, rec.progress.completedItems ? 'partial' : 'unknown');
      if (shape.category === 'cancelled' || ctx.signal.aborted) {
        if (rec.state !== 'cancelling') this.setState(rec, 'cancelling');
        this.markRemainingCancelled(rec);
        this.summarise(rec);
        this.setState(rec, 'cancelled');
      } else {
        rec.error = shape;
        this.summarise(rec);
        if (!this.setState(rec, 'failed')) {
          this.setState(rec, 'cancelling');
          this.setState(rec, 'failed');
        }
      }
    } finally {
      this.contexts.delete(id);
      this.emitUpdate(rec);
    }
  }

  private markRemainingCancelled(rec: OperationRecord): void {
    if (rec.itemResults) return;
    const done = new Set(rec.results.map((r) => r.source));
    for (const s of rec.sources) if (!done.has(s)) rec.results.push({ source: s, status: 'cancelled' });
  }

  private summarise(rec: OperationRecord): void {
    const s = { done: 0, skipped: 0, failed: 0, cancelled: 0 };
    for (const r of rec.results) s[r.status === 'done' ? 'done' : r.status]++;
    rec.summary = s;
  }

  private finish(rec: OperationRecord, ctx: RunContext): void {
    if (ctx.signal.aborted) {
      this.markRemainingCancelled(rec);
      this.summarise(rec);
      if (rec.state !== 'cancelling') this.setState(rec, 'cancelling');
      this.setState(rec, 'cancelled');
      return;
    }
    this.summarise(rec);
    const failed = rec.summary!.failed;
    const done = rec.summary!.done;
    if (failed === 0) this.setState(rec, 'completed');
    else if (done > 0 || rec.summary!.skipped > 0) this.setState(rec, 'completed_with_errors');
    else {
      rec.error ??= rec.results.find((r) => r.error)?.error;
      this.setState(rec, 'failed');
    }
  }

  private async cleanupTemps(ctx: RunContext): Promise<void> {
    for (const t of ctx.tempFiles) await fsp.rm(t, { force: true, recursive: true }).catch(() => undefined);
    ctx.tempFiles.clear();
  }

  // ---------------- controls ----------------
  cancel(id: string): void {
    const rec = this.records.get(id);
    if (!rec) throw makeError('not_found', 'ops.cancel', { message: 'Operation not found.' });
    if (TERMINAL_STATES.has(rec.state)) return;
    if (rec.state === 'queued') {
      this.queue = this.queue.filter((q) => q !== id);
      rec.results = rec.sources.map((s) => ({ source: s, status: 'cancelled' as const }));
      this.summarise(rec);
      this.setState(rec, 'cancelled');
      return;
    }
    this.setState(rec, 'cancelling');
    this.contexts.get(id)?.cancel();
  }

  /** Move a queued operation to the front (run next) or the back of the queue. Running ones are unaffected. */
  prioritize(id: string, to: 'first' | 'last'): void {
    const rec = this.records.get(id);
    if (!rec) throw makeError('not_found', 'ops.prioritize', { message: 'Operation not found.' });
    if (rec.state !== 'queued' || !this.queue.includes(id)) throw makeError('validation', 'ops.prioritize', { message: 'Only waiting operations can be reordered.' });
    this.queue = this.queue.filter((q) => q !== id);
    if (to === 'first') this.queue.unshift(id);
    else this.queue.push(id);
    this.emitUpdate(rec);
    this.pump();
  }

  /** Position of a queued operation (0 = runs next), or undefined. */
  queuePosition(id: string): number | undefined {
    const i = this.queue.indexOf(id);
    return i < 0 ? undefined : i;
  }

  pause(id: string): void {
    const rec = this.records.get(id);
    if (!rec || !rec.pausable) throw makeError('unsupported', 'ops.pause', { message: rec?.pauseUnavailable ?? 'This operation cannot be paused.' });
    const ctx = this.contexts.get(id);
    if (rec.state === 'running' && ctx) {
      ctx.pause();
      this.setState(rec, 'paused');
    }
  }

  resume(id: string): void {
    const rec = this.records.get(id);
    const ctx = this.contexts.get(id);
    if (rec?.state === 'paused' && ctx) {
      this.setState(rec, 'running');
      ctx.resume();
    }
  }

  resolveConflict(id: string, decision: ConflictDecision): void {
    const ctx = this.contexts.get(id);
    const rec = this.records.get(id);
    if (!ctx?.decisionResolver || rec?.state !== 'awaiting_conflict') throw makeError('validation', 'ops.resolveConflict', { message: 'No conflict is waiting for a decision.' });
    const r = ctx.decisionResolver;
    ctx.decisionResolver = undefined;
    r(decision);
  }

  /** Re-run an interrupted or failed operation for the items that did not complete. */
  retry(id: string): OperationRecord {
    const rec = this.records.get(id);
    if (!rec) throw makeError('not_found', 'ops.retry');
    if (!['failed', 'completed_with_errors', 'interrupted', 'cancelled'].includes(rec.state)) {
      throw makeError('validation', 'ops.retry', { message: 'Only finished operations with unfinished items can be retried.' });
    }
    const doneSources = new Set(rec.results.filter((r) => r.status === 'done').map((r) => r.source));
    const remaining = rec.sources.filter((s) => !doneSources.has(s));
    if (!remaining.length) throw makeError('validation', 'ops.retry', { message: 'Every item in this operation already completed.' });
    const partials = (rec as OperationRecord & { partials?: string[] }).partials ?? [];
    for (const p of partials) void fsp.rm(p, { force: true }).catch(() => undefined);
    const req = this.requests.get(id);
    return this.start({
      type: rec.type,
      sources: remaining,
      destination: rec.destination,
      conflictPolicy: 'ask', // conflicts are re-evaluated against the current state
      renames: req?.renames,
      origin: `retry:${id}`,
      params: req?.params,
    });
  }

  dismiss(id: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
    if (!TERMINAL_STATES.has(rec.state)) throw makeError('validation', 'ops.dismiss', { message: 'Only finished operations can be dismissed.' });
    this.records.delete(id);
    this.requests.delete(id);
    this.store?.remove(id);
    this.emit('removed', id);
  }

  /**
   * Reverse a finished operation where that can be done exactly:
   *  - rename batches are renamed back;
   *  - moves are moved back to their original folders (items that are no longer where the move put them are left alone);
   *  - copies and duplicates are moved to the Trash (only the items this operation created);
   *  - moves to the Trash are restored from the Trash (Linux), never over an item that is now in the way;
   *  - files edited in place (find and replace, text fixes) are restored from their snapshots, each only
   *    while it still has the contents the edit left.
   * Items that were merged or replaced are never undone automatically. Returns the operations started.
   */
  async undo(id: string): Promise<{ operations: OperationRecord[]; notes: string[] }> {
    const rec = this.records.get(id);
    if (!rec || !TERMINAL_STATES.has(rec.state)) throw makeError('busy', 'ops.undo', { message: 'Undo is available once the operation has finished.' });
    const u = rec.undo;
    if (!u || u.kind === 'none') throw makeError('unsupported', 'ops.undo', { message: u?.kind === 'none' ? u.reason : 'This operation cannot be undone automatically.' });
    if (rec.undoneMs) throw makeError('validation', 'ops.undo', { message: 'This operation was already undone.' });
    const origin = `undo:${id}`;
    const notes: string[] = [];
    const started: OperationRecord[] = [];
    if (u.kind === 'rename-batch') {
      const reversed = u.renames.map((r) => ({ from: r.to, to: r.from }));
      started.push(this.start({ type: 'rename-batch', sources: reversed.map((r) => r.from), renames: reversed, origin }));
    } else if (u.kind === 'trash') {
      if (!this.external.has('trash-restore')) throw makeError('unsupported', 'ops.undo', { message: this.platform.trashRestoreHint ?? 'Restore these items from the system Trash.' });
      const present: Array<{ source: string; original: string }> = [];
      for (const it of u.items) {
        const inTrash = path.join(it.trashDir, 'files', it.name);
        if (await exists(inTrash)) present.push({ source: inTrash, original: it.original });
        else notes.push(`${path.basename(it.original)} is no longer in the Trash (it was restored, deleted or the Trash was emptied).`);
      }
      // Restored to where each item was; an item now in the way is never replaced (keep both or skip).
      if (present.length) started.push(this.start({ type: 'trash-restore', sources: present.map((p) => p.source), conflictPolicy: 'ask', origin, params: { expected: present } }));
    } else if (u.kind === 'snapshots') {
      if (!this.external.has('snapshot-restore')) throw makeError('unsupported', 'ops.undo', { message: 'Restoring from snapshots is not available. Use Properties → Snapshots.' });
      const present: typeof u.items = [];
      for (const it of u.items) {
        if (await exists(it.path)) present.push(it);
        else notes.push(`${path.basename(it.path)} no longer exists; its earlier version is kept as a snapshot.`);
      }
      // Each file is checked again by the runner: one changed since the edit is left alone.
      if (present.length) started.push(this.start({ type: 'snapshot-restore', sources: present.map((p) => p.path), origin, params: { items: present } }));
    } else if (u.kind === 'operation') {
      // Power tools: the undo is another operation whose runner checks every item again before changing it.
      if (!this.external.has(u.request.type)) throw makeError('unsupported', 'ops.undo', { message: 'This operation cannot be undone here.' });
      started.push(this.start({ ...u.request, conflictPolicy: 'ask', origin }));
    } else {
      const present: Array<{ source: string; destination: string }> = [];
      for (const it of u.items) {
        if (await exists(it.destination)) present.push(it);
        else notes.push(`${path.basename(it.destination)} is no longer at ${path.dirname(it.destination)}.`);
      }
      if (u.mode === 'copy') {
        if (!this.platform.trashSupported) throw makeError('unsupported', 'ops.undo', { message: 'The Trash is not available, so copies are not removed automatically. Delete them yourself if you want.' });
        if (present.length) started.push(this.start({ type: 'trash', sources: present.map((p) => p.destination), origin }));
      } else {
        const byDir = new Map<string, Array<{ source: string; destination: string }>>();
        for (const it of present) byDir.set(path.dirname(it.source), [...(byDir.get(path.dirname(it.source)) ?? []), it]);
        for (const [dir, items] of byDir) {
          if (!(await exists(dir))) {
            notes.push(`The original folder ${dir} no longer exists; ${items.length} item(s) were left where they are.`);
            continue;
          }
          const renamed = items.filter((i) => path.basename(i.source) !== path.basename(i.destination));
          for (const r of renamed) notes.push(`${path.basename(r.destination)} keeps the name it was given when it was moved.`);
          started.push(this.start({ type: 'move', sources: items.map((i) => i.destination), destination: dir, conflictPolicy: 'ask', origin }));
        }
      }
    }
    if (!started.length) throw makeError('unavailable', 'ops.undo', { message: notes.join(' ') || 'Nothing is left to undo.' });
    if (u.kind === 'transfer' && u.cleanupDirs?.length) this.afterAll(started.map((r) => r.id), () => removeEmptyDirs(u.cleanupDirs!).then((n) => this.emit('cleanup', { id, removed: n })));
    rec.undoneMs = Date.now();
    this.emitUpdate(rec);
    this.store?.save(rec);
    return { operations: started.map((r) => structuredClone(r)), notes };
  }

  /** Run `fn` once every listed operation has reached a terminal state. */
  private afterAll(ids: string[], fn: () => unknown): void {
    const pending = new Set(ids);
    const check = () => {
      for (const i of [...pending]) {
        const r = this.records.get(i);
        if (!r || TERMINAL_STATES.has(r.state)) pending.delete(i);
      }
      if (pending.size) return false;
      this.off('update', onUpdate);
      void Promise.resolve().then(fn).catch(() => undefined);
      return true;
    };
    const onUpdate = () => void check();
    this.on('update', onUpdate);
    check();
  }

  // ---------------- conflicts ----------------
  private async askConflict(rec: OperationRecord, ctx: RunContext, info: Omit<ConflictInfo, 'operationId'>): Promise<ConflictDecision['action']> {
    if (ctx.applyToAll) return ctx.applyToAll;
    if (ctx.policy !== 'ask') {
      if (ctx.policy === 'merge' && info.sourceKind !== 'directory') return 'skip';
      return ctx.policy;
    }
    const prev = rec.state;
    rec.conflict = { ...info, operationId: rec.id };
    this.setState(rec, 'awaiting_conflict');
    this.emit('conflict', structuredClone(rec.conflict));
    const decision = await new Promise<ConflictDecision>((resolve) => {
      ctx.decisionResolver = resolve;
    });
    rec.conflict = undefined;
    if (decision.action === 'cancel') {
      ctx.cancel();
      throw makeError('cancelled', `ops.${rec.type}`);
    }
    if (decision.applyToAll) ctx.applyToAll = decision.action;
    this.setState(rec, prev === 'preparing' ? 'running' : 'running');
    return decision.action;
  }

  // ---------------- copy / move / duplicate ----------------
  private async runTransfer(rec: OperationRecord, ctx: RunContext): Promise<void> {
    const isMove = rec.type === 'move';
    const isDuplicate = rec.type === 'duplicate';
    // Prepare: validate sources and measure.
    let totalBytes = 0;
    let totalItems = 0;
    const rejected = new Set<string>();
    for (const src of rec.sources) {
      await ctx.gate();
      const dest = isDuplicate ? path.dirname(src) : rec.destination!;
      if (!isDuplicate && isWithin(src, dest)) {
        rejected.add(src);
        rec.results.push({
          source: src,
          status: 'failed',
          error: { category: 'validation', operation: `ops.${rec.type}`, message: `Cannot ${rec.type} "${path.basename(src)}" into itself.`, target: src, dataChanged: 'no', retryable: false },
        });
        continue;
      }
      try {
        const m = await measure(src, ctx.signal);
        totalBytes += m.bytes;
        totalItems += m.items;
      } catch (err) {
        const shape = toOrbisError(err, `ops.${rec.type}`, src, 'no');
        if (shape.category === 'cancelled') throw err;
        rejected.add(src);
        rec.results.push({ source: src, status: 'failed', error: shape });
      }
    }
    if (rejected.size === rec.sources.length) {
      rec.error = rec.results[0]?.error;
      return;
    }
    rec.progress = { totalItems, totalBytes, completedItems: 0, completedBytes: 0 };
    this.setState(rec, 'running');

    let lastEmit = 0;
    const tick = (bytes: number, items: number, current?: string) => {
      rec.progress.completedBytes += bytes;
      rec.progress.completedItems += items;
      if (current) rec.progress.currentItem = current;
      const t = Date.now();
      if (t - lastEmit > 120) {
        lastEmit = t;
        this.emitUpdate(rec);
      }
    };

    // Items that were created fresh (not merged into or replacing something) can be undone exactly.
    const undoItems: Array<{ source: string; destination: string }> = [];
    const setUndo = () => {
      rec.undo = undoItems.length
        ? { kind: 'transfer', mode: isMove ? 'move' : 'copy', items: undoItems.slice() }
        : { kind: 'none', reason: 'Nothing was created that can be reversed exactly (merged or replaced items are not undone automatically).' };
    };
    try {
    for (const src of rec.sources) {
      if (rejected.has(src)) continue;
      await ctx.gate();
      const destDir = isDuplicate ? path.dirname(src) : rec.destination!;
      let name = path.basename(src);
      let target = path.join(destDir, name);
      try {
        // Revalidate the source at execution time.
        const srcStat = await fsp.lstat(src).catch((err) => {
          throw new OrbisError(toOrbisError(err, `ops.${rec.type}`, src, 'no'));
        });
        if (isMove && path.resolve(src) === path.resolve(target)) {
          rec.results.push({ source: src, destination: target, status: 'skipped' });
          continue;
        }
        let mode: 'new' | 'replace' | 'merge' = 'new';
        if (isDuplicate || (await exists(target))) {
          let action: ConflictDecision['action'];
          if (isDuplicate) action = 'keep-both';
          else {
            const dstStat = await fsp.lstat(target);
            action = await this.askConflict(rec, ctx, {
              source: src,
              destination: target,
              sourceKind: kindOf(srcStat),
              destinationKind: kindOf(dstStat),
              sourceSize: srcStat.isFile() ? srcStat.size : undefined,
              destinationSize: dstStat.isFile() ? dstStat.size : undefined,
              sourceModifiedMs: srcStat.mtimeMs,
              destinationModifiedMs: dstStat.mtimeMs,
              suggestedName: await uniqueName(destDir, name, exists),
              remaining: rec.sources.length - rec.results.length,
            });
            if (action === 'merge' && !(srcStat.isDirectory() && dstStat.isDirectory())) action = 'skip';
          }
          if (action === 'skip') {
            rec.results.push({ source: src, destination: target, status: 'skipped' });
            const m = await measure(src, ctx.signal).catch(() => ({ bytes: 0, items: 1 }));
            tick(m.bytes, m.items);
            continue;
          }
          if (action === 'keep-both') {
            name = await uniqueName(destDir, name, exists);
            target = path.join(destDir, name);
          } else if (action === 'merge') mode = 'merge';
          else if (action === 'replace') mode = 'replace';
        }

        if (isMove && mode === 'new') {
          const moved = await this.tryRename(src, target);
          if (moved) {
            const m = await measure(target, ctx.signal).catch(() => ({ bytes: 0, items: 1 }));
            tick(m.bytes, m.items, name);
            rec.results.push({ source: src, destination: target, status: 'done' });
            undoItems.push({ source: src, destination: target });
            this.hooks?.onMoved(src, target);
            continue;
          }
        }

        if (mode === 'replace') await this.prepareReplace(srcStat, target, ctx);
        const itemFailures: ItemResult[] = [];
        const copyOpts: CopyOptions = { merge: mode === 'merge', replaceFile: mode === 'replace', askChild: (info) => this.askConflict(rec, ctx, info), failures: itemFailures, skipped: 0 };
        await copyTree(src, target, ctx, tick, copyOpts);
        if (itemFailures.length) {
          rec.results.push({ source: src, destination: target, status: 'failed', error: { ...itemFailures[0]!.error!, message: `${itemFailures.length} item(s) inside could not be copied. ${itemFailures[0]!.error!.message}`, dataChanged: 'partial' } });
          continue; // never remove the source of a move whose copy was incomplete
        }
        if (isMove && copyOpts.skipped > 0) {
          rec.results.push({
            source: src,
            destination: target,
            status: 'failed',
            error: { category: 'already_exists', operation: 'ops.move', message: `${copyOpts.skipped} conflicting item(s) were skipped, so the original folder was kept. Everything else was copied.`, dataChanged: 'yes', retryable: false, target: src },
          });
          continue;
        }
        if (isMove) {
          // Verify before removing the source.
          const [a, b] = await Promise.all([measure(src, ctx.signal), measure(target, ctx.signal)]);
          if (mode !== 'merge' && (a.bytes !== b.bytes || a.items !== b.items)) {
            rec.results.push({
              source: src,
              destination: target,
              status: 'failed',
              error: { category: 'io', operation: 'ops.move', message: 'The copy could not be verified, so the original was kept.', dataChanged: 'yes', retryable: true, target: src },
            });
            continue;
          }
          await ctx.gate();
          await fsp.rm(src, { recursive: true, force: false });
          this.hooks?.onMoved(src, target);
        }
        rec.results.push({ source: src, destination: target, status: 'done' });
        if (mode === 'new') undoItems.push({ source: src, destination: target });
      } catch (err) {
        const shape = toOrbisError(err, `ops.${rec.type}`, src);
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: src, destination: target, status: 'failed', error: shape });
      }
    }
    } finally {
      setUndo();
    }
  }

  /** Same-volume move: rename without clobbering an existing destination. */
  private async tryRename(src: string, target: string): Promise<boolean> {
    try {
      if (await exists(target)) throw makeError('already_exists', 'ops.move', { target });
      await fsp.rename(src, target);
      return true;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EXDEV') return false;
      throw err;
    }
  }

  /** "Replace": a replaced directory goes to Trash (recoverable); a file is atomically replaced after copy. */
  private async prepareReplace(srcStat: fs.Stats, target: string, ctx: RunContext): Promise<void> {
    await ctx.gate();
    const dst = await fsp.lstat(target);
    if (dst.isDirectory() || srcStat.isDirectory()) {
      if (!this.platform.trashSupported) {
        throw makeError('unsupported', 'ops.replace', { message: 'Replacing a folder requires Trash, which is not available. Choose Keep both or Merge.', target });
      }
      await this.platform.trash(target);
    }
  }

  // ---------------- trash / delete ----------------
  private async runRemove(rec: OperationRecord, ctx: RunContext): Promise<void> {
    let totalItems = 0;
    for (const s of rec.sources) {
      if (isProtectedPath(s)) throw makeError('permission_denied', `ops.${rec.type}`, { target: s });
      totalItems++;
    }
    rec.progress = { totalItems, completedItems: 0, completedBytes: 0 };
    this.setState(rec, 'running');
    // Where the Trash put each item, so the operation can be undone by restoring them.
    const trashed: Array<{ original: string; trashDir: string; name: string }> = [];
    let unlocated = 0;
    try {
      for (const src of rec.sources) {
        await ctx.gate();
        rec.progress.currentItem = path.basename(src);
        try {
          await fsp.lstat(src);
          if (rec.type === 'trash') {
            const since = Date.now();
            await this.platform.trash(src);
            if (this.platform.locateTrashed) {
              const loc = await this.platform.locateTrashed(src, since).catch(() => undefined);
              if (loc) trashed.push({ original: src, trashDir: loc.trashDir, name: loc.name });
              else unlocated++;
            }
          } else await fsp.rm(src, { recursive: true, force: false, maxRetries: 2 });
          rec.results.push({ source: src, status: 'done' });
          this.hooks?.onRemoved(src);
        } catch (err) {
          rec.results.push({ source: src, status: 'failed', error: toOrbisError(err, `ops.${rec.type}`, src, 'unknown') });
        }
        rec.progress.completedItems++;
        this.emitUpdate(rec);
      }
    } finally {
      if (rec.type === 'trash') {
        const hint = this.platform.trashRestoreHint ?? 'Restore them from the system Trash.';
        if (!this.platform.locateTrashed) rec.undo = { kind: 'none', reason: `Orbis Files cannot restore from the Trash on this system. ${hint}` };
        else if (trashed.length) {
          rec.undo = { kind: 'trash', items: trashed };
          if (unlocated) rec.notes = [...(rec.notes ?? []), `${unlocated} item(s) could not be found in the Trash afterwards, so Undo does not cover them. Restore them from the Trash view.`];
        } else rec.undo = { kind: 'none', reason: 'The items could not be identified in the Trash afterwards. Restore them from the Trash view.' };
      }
    }
  }

  // ---------------- batch rename ----------------
  private async runRenameBatch(rec: OperationRecord, req: OperationRequest, ctx: RunContext): Promise<void> {
    const renames = (req.renames ?? []).filter((r) => r.from !== r.to);
    const validation = await validateRenamePlan(renames);
    if (validation.errors.length) {
      throw makeError('validation', 'ops.rename-batch', { message: validation.errors[0]!, cause: validation.errors.slice(0, 20).join('; ') });
    }
    rec.progress = { totalItems: renames.length, completedItems: 0, completedBytes: 0 };
    this.setState(rec, 'running');
    // Two phases so swaps and chains (a→b, b→a) succeed: first move every item to a temp name.
    const temps: Array<{ from: string; tmp: string; to: string }> = [];
    const applied: Array<{ from: string; to: string }> = [];
    for (const r of renames) {
      await ctx.gate().catch(async (e) => {
        await rollbackTemps(temps);
        throw e;
      });
      const tmp = path.join(path.dirname(r.from), `${PART_PREFIX}rn-${crypto.randomUUID()}`);
      try {
        await fsp.rename(r.from, tmp);
        temps.push({ from: r.from, tmp, to: r.to });
      } catch (err) {
        rec.results.push({ source: r.from, destination: r.to, status: 'failed', error: toOrbisError(err, 'ops.rename-batch', r.from, 'no') });
      }
    }
    for (const t of temps) {
      try {
        if (await exists(t.to)) throw makeError('already_exists', 'ops.rename-batch', { target: t.to });
        await fsp.rename(t.tmp, t.to);
        applied.push({ from: t.from, to: t.to });
        rec.results.push({ source: t.from, destination: t.to, status: 'done' });
        this.hooks?.onMoved(t.from, t.to);
      } catch (err) {
        // Put the item back under its original name.
        await fsp.rename(t.tmp, t.from).catch(() => undefined);
        rec.results.push({ source: t.from, destination: t.to, status: 'failed', error: toOrbisError(err, 'ops.rename-batch', t.from, 'no') });
      }
      rec.progress.completedItems++;
    }
    rec.undo = applied.length ? { kind: 'rename-batch', renames: applied } : { kind: 'none', reason: 'Nothing was renamed.' };
    rec.sources = renames.map((r) => r.from);
  }
}

/** Remove folders that are empty (deepest first); anything not empty, not a folder or a link is left alone. */
export async function removeEmptyDirs(dirs: string[]): Promise<number> {
  let removed = 0;
  const sorted = [...new Set(dirs.map((d) => path.resolve(d)))].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length || b.localeCompare(a));
  for (const d of sorted) {
    const st = await fsp.lstat(d).catch(() => undefined);
    if (!st?.isDirectory()) continue;
    await fsp.rmdir(d).then(() => removed++, () => undefined);
  }
  return removed;
}

async function rollbackTemps(temps: Array<{ from: string; tmp: string }>): Promise<void> {
  for (const t of temps.reverse()) await fsp.rename(t.tmp, t.from).catch(() => undefined);
}

/** Validate a batch rename before touching the disk. */
export async function validateRenamePlan(renames: Array<{ from: string; to: string }>): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const targets = new Map<string, string>();
  const sources = new Set(renames.map((r) => path.resolve(r.from)));
  for (const r of renames) {
    const name = path.basename(r.to);
    const v = validateName(name);
    if (!v.valid) errors.push(`"${name}": ${v.reason}`);
    if (path.dirname(path.resolve(r.to)) !== path.dirname(path.resolve(r.from))) errors.push(`"${name}" would move the item to another folder.`);
    const key = process.platform === 'linux' ? path.resolve(r.to) : path.resolve(r.to).toLowerCase();
    if (targets.has(key)) errors.push(`Two items would be named "${name}".`);
    targets.set(key, r.from);
    const fromSt = await fsp.lstat(r.from).catch(() => undefined);
    if (!fromSt) errors.push(`"${path.basename(r.from)}" no longer exists.`);
    if (!sources.has(path.resolve(r.to))) {
      const toSt = await fsp.lstat(r.to).catch(() => undefined);
      // The same file under another case (case-insensitive drive) is a case-only rename, not a clash.
      if (toSt && !(fromSt && toSt.ino === fromSt.ino && toSt.dev === fromSt.dev)) errors.push(`"${name}" already exists.`);
    }
  }
  return { errors };
}

function kindOf(st: fs.Stats): ConflictInfo['sourceKind'] {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

/** Count bytes and entries under a path without following symlinks. */
export async function measure(p: string, signal: AbortSignal): Promise<{ bytes: number; items: number }> {
  const st = await fsp.lstat(p);
  if (!st.isDirectory()) return { bytes: st.isFile() ? st.size : 0, items: 1 };
  let bytes = 0;
  let items = 1;
  const seen = new Set<string>([`${st.dev}:${st.ino}`]);
  const stack = [p];
  while (stack.length) {
    if (signal.aborted) throw makeError('cancelled', 'ops.measure');
    const dir = stack.pop()!;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const child = path.join(dir, e.name);
      if (e.name.startsWith(PART_PREFIX)) continue;
      const cs = await fsp.lstat(child);
      items++;
      if (cs.isDirectory()) {
        const key = `${cs.dev}:${cs.ino}`;
        if (!seen.has(key)) {
          seen.add(key);
          stack.push(child);
        }
      } else if (cs.isFile()) bytes += cs.size;
    }
  }
  return { bytes, items };
}

interface CopyOptions {
  merge: boolean;
  replaceFile: boolean;
  askChild: (info: Omit<ConflictInfo, 'operationId'>) => Promise<ConflictDecision['action']>;
  failures: ItemResult[];
  /** Count of conflicting children the user chose to skip during a merge. */
  skipped: number;
}

/**
 * Copy src to dst. Symlinks are recreated as links (never followed). Files are
 * written to a temporary sibling, fsynced, then committed: exclusively with
 * link() for new files so a destination created meanwhile is never clobbered,
 * or by atomic rename for an explicit replace.
 */
export async function copyTree(
  src: string,
  dst: string,
  ctx: RunContext,
  tick: (bytes: number, items: number, current?: string) => void,
  opts: CopyOptions,
): Promise<void> {
  await ctx.gate();
  const st = await fsp.lstat(src);
  if (st.isSymbolicLink()) {
    const target = await fsp.readlink(src);
    await fsp.symlink(target, dst);
    tick(0, 1, path.basename(src));
    return;
  }
  if (st.isDirectory()) {
    if (opts.merge) await fsp.mkdir(dst, { recursive: true });
    else await fsp.mkdir(dst);
    tick(0, 1, path.basename(src));
    const entries = await fsp.readdir(src);
    for (const name of entries) {
      if (name.startsWith(PART_PREFIX)) continue;
      const s = path.join(src, name);
      let d = path.join(dst, name);
      try {
        if (opts.merge && (await exists(d))) {
          const [ss, ds] = await Promise.all([fsp.lstat(s), fsp.lstat(d)]);
          if (ss.isDirectory() && ds.isDirectory()) {
            await copyTree(s, d, ctx, tick, opts);
            continue;
          }
          const action = await opts.askChild({
            source: s, destination: d, sourceKind: kindOf(ss), destinationKind: kindOf(ds),
            sourceSize: ss.isFile() ? ss.size : undefined, destinationSize: ds.isFile() ? ds.size : undefined,
            sourceModifiedMs: ss.mtimeMs, destinationModifiedMs: ds.mtimeMs,
            suggestedName: await uniqueName(dst, name, exists), remaining: 0,
          });
          if (action === 'skip' || action === 'merge') {
            opts.skipped++;
            const m = await measure(s, ctx.signal);
            tick(m.bytes, m.items);
            continue;
          }
          if (action === 'keep-both') d = path.join(dst, await uniqueName(dst, name, exists));
          await copyTree(s, d, ctx, tick, { ...opts, replaceFile: action === 'replace' });
          continue;
        }
        await copyTree(s, d, ctx, tick, { ...opts, replaceFile: false });
      } catch (err) {
        const shape = toOrbisError(err, 'ops.copy', s);
        if (shape.category === 'cancelled') throw err;
        opts.failures.push({ source: s, destination: d, status: 'failed', error: shape });
      }
    }
    await fsp.utimes(dst, st.atime, st.mtime).catch(() => undefined);
    return;
  }
  if (!st.isFile()) {
    throw makeError('unsupported', 'ops.copy', { message: 'Special files (devices, sockets, pipes) are not copied.', target: src });
  }
  await copyFileAtomic(src, dst, st, ctx, tick, opts.replaceFile);
}

async function copyFileAtomic(
  src: string,
  dst: string,
  st: fs.Stats,
  ctx: RunContext,
  tick: (bytes: number, items: number, current?: string) => void,
  replace: boolean,
): Promise<void> {
  const tmp = path.join(path.dirname(dst), `${PART_PREFIX}${crypto.randomUUID()}`);
  ctx.tempFiles.add(tmp);
  const name = path.basename(src);
  const gateTransform = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      ctx.gate().then(
        () => {
          tick(chunk.length, 0, name);
          cb(null, chunk);
        },
        (err) => cb(err),
      );
    },
  });
  const out = fs.createWriteStream(tmp, { flags: 'wx', mode: st.mode & 0o777 });
  try {
    await pipeline(fs.createReadStream(src, { highWaterMark: 1024 * 1024 }), gateTransform, out, { signal: ctx.signal });
  } catch (err) {
    if (ctx.signal.aborted) throw makeError('cancelled', 'ops.copy', { target: src, dataChanged: 'no' });
    throw err;
  }
  const fh = await fsp.open(tmp, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  const written = (await fsp.stat(tmp)).size;
  if (written !== st.size) {
    throw makeError('io', 'ops.copy', { message: 'The copied file size does not match the original (the source may have changed during copying).', target: src, dataChanged: 'no', retryable: true });
  }
  await fsp.utimes(tmp, st.atime, st.mtime).catch(() => undefined);
  if (replace) {
    await fsp.rename(tmp, dst); // atomic replace of a file the user chose to overwrite
  } else {
    try {
      await fsp.link(tmp, dst); // fails with EEXIST rather than overwriting
      await fsp.unlink(tmp);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EEXIST') throw new OrbisError({ category: 'already_exists', operation: 'ops.copy', message: `"${path.basename(dst)}" appeared at the destination during the copy and was not overwritten.`, target: dst, dataChanged: 'no', retryable: true });
      // No hard-link support (e.g. FAT, some network shares): fall back to an existence check + rename.
      if (await exists(dst)) throw makeError('already_exists', 'ops.copy', { target: dst });
      await fsp.rename(tmp, dst);
    }
  }
  ctx.tempFiles.delete(tmp);
  tick(0, 1);
}

export type { OrbisErrorShape };
export { splitExt };
